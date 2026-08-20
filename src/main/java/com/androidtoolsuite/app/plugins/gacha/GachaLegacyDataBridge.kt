package com.androidtoolsuite.app.plugins.gacha

import android.app.Activity
import android.content.SharedPreferences
import com.androidtoolsuite.app.plugin.migration.DatasetCategory
import com.androidtoolsuite.app.plugin.migration.DatasetRestoreMode
import com.androidtoolsuite.app.plugin.migration.LegacyDataBridge
import com.androidtoolsuite.app.plugin.migration.LegacyDatasetDescriptor
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream

internal class GachaLegacyDataBridge : LegacyDataBridge {
    override fun datasets(activity: Activity): List<LegacyDatasetDescriptor> {
        val database = activity.getDatabasePath(GachaStore.DATABASE_NAME)
        val databaseSize = database.length().coerceAtLeast(0L)
        val result = mutableListOf(
            LegacyDatasetDescriptor(
                "gacha-settings",
                "账号选择与分析设置",
                DatasetCategory.SETTINGS,
                preferencesJson(activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE))
                    .toString().toByteArray().size.toLong(),
                1,
                false,
                DatasetRestoreMode.REPLACE,
            ),
        )
        if (database.isFile) {
            result += LegacyDatasetDescriptor(
                "genshin-records",
                "原神祈愿记录",
                DatasetCategory.DATA,
                databaseSize / 2,
                1,
                false,
                DatasetRestoreMode.MERGE,
            )
            result += LegacyDatasetDescriptor(
                "starrail-records",
                "星穹铁道跃迁记录",
                DatasetCategory.DATA,
                databaseSize / 2,
                1,
                false,
                DatasetRestoreMode.MERGE,
            )
        }
        if (MihoyoSessionStore(activity).hasSession()) {
            result += LegacyDatasetDescriptor(
                "mihoyo-session",
                "米游社会话",
                DatasetCategory.SECRET,
                1024,
                1,
                true,
                DatasetRestoreMode.REPLACE,
            )
        }
        return result
    }

    override fun exportDataset(activity: Activity, datasetId: String, output: OutputStream) {
        when (datasetId) {
            "gacha-settings" -> output.write(
                JSONObject()
                    .put("formatVersion", 1)
                    .put("preferences", preferencesJson(activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)))
                    .toString()
                    .toByteArray(Charsets.UTF_8),
            )
            "genshin-records" -> GachaStore(activity).use {
                it.exportLegacyDatasetReadOnly(activity, GameKind.GENSHIN, output)
            }
            "starrail-records" -> GachaStore(activity).use {
                it.exportLegacyDatasetReadOnly(activity, GameKind.STAR_RAIL, output)
            }
            "mihoyo-session" -> {
                val session = requireNotNull(MihoyoSessionStore(activity).migrationSession()) {
                    "米游社会话不存在或无法解密"
                }
                output.write(
                    JSONObject()
                        .put("formatVersion", 1)
                        .put("session", session)
                        .toString()
                        .toByteArray(Charsets.UTF_8),
                )
            }
            else -> error("未知 Dataset：$datasetId")
        }
    }

    override fun supportsImport(datasetId: String, dataFormatVersion: Int): Boolean =
        dataFormatVersion == 1 && datasetId in SUPPORTED_IMPORTS

    override fun importDataset(
        activity: Activity,
        datasetId: String,
        dataFormatVersion: Int,
        input: InputStream,
    ) {
        require(supportsImport(datasetId, dataFormatVersion)) { "不支持的抽卡分析 Dataset" }
        when (datasetId) {
            "gacha-settings" -> {
                val expected = restorePreferences(
                    activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE),
                    input,
                    dataFormatVersion,
                )
                check(
                    restoredPreferencesMatch(
                        activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE),
                        expected,
                    ),
                ) { "抽卡分析设置恢复校验失败" }
            }
            "genshin-records", "starrail-records" -> {
                val game = if (datasetId == "genshin-records") GameKind.GENSHIN else GameKind.STAR_RAIL
                GachaStore(activity).use { store ->
                    val expected = store.importLegacyDataset(input, game, dataFormatVersion)
                    store.validateLegacyDataset(expected)
                }
            }
            "mihoyo-session" -> {
                val root = JSONObject(input.reader(Charsets.UTF_8).readText())
                require(root.optInt("formatVersion", 0) == dataFormatVersion) {
                    "米游社会话格式版本不一致"
                }
                val session = root.getString("session")
                val store = MihoyoSessionStore(activity)
                store.save(session)
                check(store.migrationSession() == session) { "米游社会话恢复校验失败" }
            }
        }
    }

    private fun restorePreferences(
        preferences: SharedPreferences,
        input: InputStream,
        dataFormatVersion: Int,
    ): Map<String, Any> {
        val root = JSONObject(input.reader(Charsets.UTF_8).readText())
        require(root.optInt("formatVersion", 0) == dataFormatVersion) { "抽卡设置格式版本不一致" }
        val data = root.getJSONObject("preferences")
        val editor = preferences.edit().clear()
        val expected = linkedMapOf<String, Any>()
        val keys = data.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val item = data.getJSONObject(key)
            when (item.getString("type")) {
                "boolean" -> item.getBoolean("value").also { expected[key] = it; editor.putBoolean(key, it) }
                "int" -> item.getInt("value").also { expected[key] = it; editor.putInt(key, it) }
                "long" -> item.getLong("value").also { expected[key] = it; editor.putLong(key, it) }
                "float" -> item.getDouble("value").toFloat().also { expected[key] = it; editor.putFloat(key, it) }
                "string" -> item.getString("value").also { expected[key] = it; editor.putString(key, it) }
                "stringSet" -> {
                    val values = item.getJSONArray("value")
                    val set = (0 until values.length()).mapTo(linkedSetOf()) { values.getString(it) }
                    expected[key] = set
                    editor.putStringSet(key, set)
                }
                else -> error("不支持的设置类型：${item.getString("type")}")
            }
        }
        check(editor.commit()) { "无法保存抽卡分析设置" }
        return expected
    }

    private fun preferencesJson(preferences: SharedPreferences): JSONObject = JSONObject().also { result ->
        preferences.all.toSortedMap().forEach { (key, value) ->
            val item = JSONObject()
            when (value) {
                is Boolean -> item.put("type", "boolean").put("value", value)
                is Int -> item.put("type", "int").put("value", value)
                is Long -> item.put("type", "long").put("value", value)
                is Float -> item.put("type", "float").put("value", value.toDouble())
                is String -> item.put("type", "string").put("value", value)
                is Set<*> -> item.put("type", "stringSet").put(
                    "value",
                    JSONArray(value.filterIsInstance<String>().sorted()),
                )
                else -> return@forEach
            }
            result.put(key, item)
        }
    }

    private companion object {
        const val PREFS_NAME = "gacha-analysis-preferences"
        val SUPPORTED_IMPORTS = setOf(
            "gacha-settings",
            "genshin-records",
            "starrail-records",
            "mihoyo-session",
        )
    }
}

internal fun restoredPreferencesMatch(
    preferences: SharedPreferences,
    expected: Map<String, Any>,
): Boolean {
    if (preferences.all.keys != expected.keys) return false
    return expected.all { (key, value) ->
        when (value) {
            is Boolean -> preferences.getBoolean(key, !value) == value
            is Int -> preferences.getInt(key, value xor Int.MIN_VALUE) == value
            is Long -> preferences.getLong(key, value xor Long.MIN_VALUE) == value
            is Float -> java.lang.Float.floatToIntBits(preferences.getFloat(key, Float.NaN)) ==
                java.lang.Float.floatToIntBits(value)
            is String -> preferences.getString(key, null) == value
            is Set<*> -> preferences.getStringSet(key, null)?.toSet() == value.filterIsInstance<String>().toSet()
            else -> false
        }
    }
}
