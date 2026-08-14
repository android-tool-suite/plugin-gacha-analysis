package com.androidtoolsuite.app.plugins.gacha

import android.app.Activity
import android.content.SharedPreferences
import com.androidtoolsuite.app.plugin.migration.DatasetCategory
import com.androidtoolsuite.app.plugin.migration.DatasetRestoreMode
import com.androidtoolsuite.app.plugin.migration.LegacyDataBridge
import com.androidtoolsuite.app.plugin.migration.LegacyDatasetDescriptor
import org.json.JSONArray
import org.json.JSONObject
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
    }
}
