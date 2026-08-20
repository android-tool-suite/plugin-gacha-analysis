package com.androidtoolsuite.app.plugins.gacha

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.JsonReader
import android.util.JsonToken
import android.util.JsonWriter
import java.io.FilterOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream
import java.io.OutputStreamWriter

internal data class GachaBundle(
    val account: GachaAccount,
    val records: List<GachaRecord>,
    val completedPoolTypes: Set<String> = emptySet(),
)
internal data class MergeResult(val inserted: Int, val skipped: Int, val accounts: Int)

internal class GachaStore(context: Context) : SQLiteOpenHelper(
    context.applicationContext,
    DATABASE_NAME,
    null,
    DATABASE_VERSION,
) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE accounts (
                game TEXT NOT NULL,
                uid TEXT NOT NULL,
                region TEXT NOT NULL DEFAULT '',
                timezone INTEGER NOT NULL DEFAULT 8,
                lang TEXT NOT NULL DEFAULT 'zh-cn',
                last_sync INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (game, uid)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE records (
                game TEXT NOT NULL,
                uid TEXT NOT NULL,
                id TEXT NOT NULL,
                gacha_type TEXT NOT NULL,
                uigf_gacha_type TEXT NOT NULL DEFAULT '',
                gacha_id TEXT NOT NULL DEFAULT '',
                item_id TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                item_type TEXT NOT NULL DEFAULT '',
                rank_type TEXT NOT NULL DEFAULT '',
                count TEXT NOT NULL DEFAULT '1',
                time TEXT NOT NULL,
                is_up TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (game, uid, id)
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX records_account_pool_time ON records(game, uid, uigf_gacha_type, time, id)")
        createAccountOrderIndex(db)
        createPoolSyncStateTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) createAccountOrderIndex(db)
        if (oldVersion < 3) db.execSQL("ALTER TABLE records ADD COLUMN is_up TEXT NOT NULL DEFAULT ''")
        if (oldVersion < 4) createPoolSyncStateTable(db)
    }

    fun accounts(): List<GachaAccount> {
        val result = mutableListOf<GachaAccount>()
        readableDatabase.query(
            "accounts",
            arrayOf("game", "uid", "region", "timezone", "lang", "last_sync"),
            null,
            null,
            null,
            null,
            "last_sync DESC, game ASC, uid ASC",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val game = GameKind.fromCode(cursor.getString(0)) ?: continue
                result += GachaAccount(
                    game = game,
                    uid = cursor.getString(1),
                    region = cursor.getString(2),
                    timezone = cursor.getInt(3),
                    lang = cursor.getString(4),
                    lastSyncAt = cursor.getLong(5),
                )
            }
        }
        return result
    }

    fun records(account: GachaAccount): List<GachaRecord> {
        val result = mutableListOf<GachaRecord>()
        readableDatabase.query(
            "records",
            RECORD_COLUMNS,
            "game = ? AND uid = ?",
            arrayOf(account.game.code, account.uid),
            null,
            null,
            "time DESC, length(id) DESC, id DESC",
        ).use { cursor ->
            while (cursor.moveToNext()) result += cursor.toRecord(account.game)
        }
        return result
    }

    fun recordIds(game: GameKind, uid: String, poolType: String): Set<String> {
        val result = LinkedHashSet<String>()
        readableDatabase.query(
            "records",
            arrayOf("id"),
            "game = ? AND uid = ? AND (uigf_gacha_type = ? OR gacha_type = ?)",
            arrayOf(game.code, uid, game.normalizedPoolType(poolType), poolType),
            null,
            null,
            null,
        ).use { cursor -> while (cursor.moveToNext()) result += cursor.getString(0) }
        return result
    }

    fun isHistoryComplete(game: GameKind, uid: String, poolType: String): Boolean {
        readableDatabase.query(
            "pool_sync_state",
            arrayOf("history_complete"),
            "game = ? AND uid = ? AND pool_type = ?",
            arrayOf(game.code, uid, poolType),
            null,
            null,
            null,
            "1",
        ).use { cursor -> return cursor.moveToFirst() && cursor.getInt(0) != 0 }
    }

    fun merge(bundle: GachaBundle): MergeResult = merge(listOf(bundle))

    fun merge(bundles: List<GachaBundle>): MergeResult {
        var inserted = 0
        var skipped = 0
        val db = writableDatabase
        db.beginTransaction()
        try {
            bundles.forEach { bundle ->
                upsertAccount(db, bundle.account)
                bundle.records.forEach { record ->
                    val row = db.insertWithOnConflict(
                        "records",
                        null,
                        record.toValues(),
                        SQLiteDatabase.CONFLICT_IGNORE,
                    )
                    if (row == -1L) skipped += 1 else inserted += 1
                }
                bundle.completedPoolTypes.forEach { poolType ->
                    markHistoryComplete(db, bundle.account, poolType)
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return MergeResult(inserted, skipped, bundles.size)
    }

    fun deleteAccount(account: GachaAccount) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val args = arrayOf(account.game.code, account.uid)
            db.delete("pool_sync_state", "game = ? AND uid = ?", args)
            db.delete("records", "game = ? AND uid = ?", args)
            db.delete("accounts", "game = ? AND uid = ?", args)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun deleteGame(game: GameKind) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val args = arrayOf(game.code)
            db.delete("pool_sync_state", "game = ?", args)
            db.delete("records", "game = ?", args)
            db.delete("accounts", "game = ?", args)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        check(accounts().none { it.game == game }) { "抽卡账号删除校验失败" }
    }

    /** Opens the v1 database read-only so Bridge export can never trigger a schema upgrade. */
    fun exportLegacyDatasetReadOnly(context: Context, game: GameKind, output: OutputStream) {
        val databaseFile = context.getDatabasePath(DATABASE_NAME)
        require(databaseFile.isFile) { "旧抽卡数据库不存在" }
        SQLiteDatabase.openDatabase(databaseFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            writeLegacyDataset(database, game, output)
        }
    }

    private fun writeLegacyDataset(database: SQLiteDatabase, game: GameKind, output: OutputStream) {
        JsonWriter(OutputStreamWriter(NonClosingOutputStream(output), Charsets.UTF_8)).use { json ->
            json.beginObject()
            json.name("formatVersion").value(1L)
            json.name("game").value(game.code)
            json.name("accounts").beginArray()
            database.query(
                "accounts",
                arrayOf("uid", "region", "timezone", "lang", "last_sync"),
                "game = ?",
                arrayOf(game.code),
                null,
                null,
                "uid ASC",
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    json.beginObject()
                    json.name("uid").value(cursor.getString(0))
                    json.name("region").value(cursor.getString(1))
                    json.name("timezone").value(cursor.getInt(2).toLong())
                    json.name("lang").value(cursor.getString(3))
                    json.name("lastSyncAt").value(cursor.getLong(4))
                    json.endObject()
                }
            }
            json.endArray()
            json.name("records").beginArray()
            val columns = RECORD_COLUMNS.drop(1)
            database.query(
                "records",
                columns.toTypedArray(),
                "game = ?",
                arrayOf(game.code),
                null,
                null,
                "uid ASC, length(id) ASC, id ASC",
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    json.beginObject()
                    columns.forEachIndexed { index, column -> json.name(column).value(cursor.getString(index)) }
                    json.endObject()
                }
            }
            json.endArray()
            json.name("poolSyncState").beginArray()
            database.query(
                "pool_sync_state",
                arrayOf("uid", "pool_type", "history_complete"),
                "game = ?",
                arrayOf(game.code),
                null,
                null,
                "uid ASC, pool_type ASC",
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    json.beginObject()
                    json.name("uid").value(cursor.getString(0))
                    json.name("poolType").value(cursor.getString(1))
                    json.name("historyComplete").value(cursor.getInt(2) != 0)
                    json.endObject()
                }
            }
            json.endArray()
            json.endObject()
            json.flush()
        }
    }

    /** JsonWriter may close its encoder, but the Host owns the enclosing Dataset stream. */
    private class NonClosingOutputStream(output: OutputStream) : FilterOutputStream(output) {
        override fun close() = flush()
    }

    /** Streams a Bridge Dataset into the v1 database inside one SQLite transaction. */
    fun importLegacyDataset(
        input: InputStream,
        expectedGame: GameKind,
        expectedFormatVersion: Int,
        replaceExisting: Boolean = false,
    ): GachaDatasetIntegrity {
        var formatVersion = 0
        var game: GameKind? = null
        val accountUids = linkedSetOf<String>()
        val recordKeys = linkedSetOf<String>()
        val poolStates = linkedMapOf<String, Boolean>()
        val db = writableDatabase
        db.beginTransaction()
        val integrity = try {
            if (replaceExisting) {
                val args = arrayOf(expectedGame.code)
                db.delete("records", "game = ?", args)
                db.delete("pool_sync_state", "game = ?", args)
                db.delete("accounts", "game = ?", args)
            }
            val json = JsonReader(InputStreamReader(input, Charsets.UTF_8))
            json.beginObject()
            while (json.hasNext()) {
                when (json.nextName()) {
                    "formatVersion" -> formatVersion = json.nextInt()
                    "game" -> {
                        game = requireNotNull(GameKind.fromCode(json.nextString())) { "Dataset 游戏类型无效" }
                        require(game == expectedGame) { "Dataset 游戏类型与所选数据集不一致" }
                    }
                    "accounts" -> {
                        val resolvedGame = requireNotNull(game) { "Dataset 必须先声明游戏类型" }
                        json.beginArray()
                        while (json.hasNext()) {
                            val account = readDatasetAccount(json, resolvedGame)
                            accountUids += account.uid
                            upsertAccount(db, account)
                        }
                        json.endArray()
                    }
                    "records" -> {
                        val resolvedGame = requireNotNull(game) { "Dataset 必须先声明游戏类型" }
                        json.beginArray()
                        while (json.hasNext()) {
                            val record = readDatasetRecord(json, resolvedGame)
                            accountUids += record.uid
                            ensureDatasetAccount(db, resolvedGame, record.uid)
                            db.insertWithOnConflict(
                                "records",
                                null,
                                record.toValues(),
                                SQLiteDatabase.CONFLICT_IGNORE,
                            )
                            recordKeys += GachaDatasetIntegrity.recordKey(
                                resolvedGame.code,
                                record.uid,
                                record.id,
                            )
                        }
                        json.endArray()
                    }
                    "poolSyncState" -> {
                        val resolvedGame = requireNotNull(game) { "Dataset 必须先声明游戏类型" }
                        json.beginArray()
                        while (json.hasNext()) {
                            val state = readDatasetPoolState(json)
                            accountUids += state.uid
                            ensureDatasetAccount(db, resolvedGame, state.uid)
                            writePoolSyncState(
                                db,
                                resolvedGame,
                                state.uid,
                                state.poolType,
                                state.complete,
                            )
                            poolStates[GachaDatasetIntegrity.poolKey(
                                resolvedGame.code,
                                state.uid,
                                state.poolType,
                            )] = state.complete
                        }
                        json.endArray()
                    }
                    else -> json.skipValue()
                }
            }
            json.endObject()
            require(formatVersion == expectedFormatVersion) { "抽卡 Dataset 格式版本不一致" }
            val resolvedGame = requireNotNull(game) { "Dataset 缺少游戏类型" }
            db.setTransactionSuccessful()
            GachaDatasetIntegrity(resolvedGame.code, accountUids, recordKeys, poolStates)
        } finally {
            db.endTransaction()
        }
        return integrity
    }

    fun validateLegacyDataset(expected: GachaDatasetIntegrity) {
        val foundAccounts = linkedSetOf<String>()
        readableDatabase.query(
            "accounts",
            arrayOf("uid"),
            "game = ?",
            arrayOf(expected.gameCode),
            null,
            null,
            "uid ASC",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                cursor.getString(0).takeIf(expected.accountUids::contains)?.let(foundAccounts::add)
            }
        }
        check(foundAccounts.size == expected.accountCount) {
            "抽卡 Dataset 账号校验失败：期望 ${expected.accountCount}，实际 ${foundAccounts.size}"
        }

        val foundRecords = linkedSetOf<String>()
        readableDatabase.query(
            "records",
            arrayOf("uid", "id"),
            "game = ?",
            arrayOf(expected.gameCode),
            null,
            null,
            "uid ASC, length(id) ASC, id ASC",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val key = GachaDatasetIntegrity.recordKey(
                    expected.gameCode,
                    cursor.getString(0),
                    cursor.getString(1),
                )
                if (key in expected.recordKeys) foundRecords += key
            }
        }
        val foundDigest = GachaDatasetIntegrity.digest(foundRecords)
        check(foundRecords.size == expected.recordCount && foundDigest == expected.recordDigest) {
            "抽卡 Dataset 记录校验失败：期望 ${expected.recordCount}/${expected.recordDigest}，" +
                "实际 ${foundRecords.size}/$foundDigest"
        }

        val foundPoolStates = linkedMapOf<String, Boolean>()
        readableDatabase.query(
            "pool_sync_state",
            arrayOf("uid", "pool_type", "history_complete"),
            "game = ?",
            arrayOf(expected.gameCode),
            null,
            null,
            "uid ASC, pool_type ASC",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val key = GachaDatasetIntegrity.poolKey(
                    expected.gameCode,
                    cursor.getString(0),
                    cursor.getString(1),
                )
                if (key in expected.poolStates) foundPoolStates[key] = cursor.getInt(2) != 0
            }
        }
        check(foundPoolStates == expected.poolStates) { "抽卡 Dataset 卡池同步状态校验失败" }
    }

    private fun readDatasetAccount(json: JsonReader, game: GameKind): GachaAccount {
        var uid: String? = null
        var region = ""
        var timezone = 8
        var lang = "zh-cn"
        var lastSyncAt = 0L
        json.beginObject()
        while (json.hasNext()) when (json.nextName()) {
            "uid" -> uid = json.nextString()
            "region" -> region = nextDatasetString(json, "")
            "timezone" -> timezone = json.nextInt()
            "lang" -> lang = nextDatasetString(json, "zh-cn")
            "lastSyncAt" -> lastSyncAt = json.nextLong()
            else -> json.skipValue()
        }
        json.endObject()
        return GachaAccount(
            game,
            requireNotNull(uid?.takeIf(String::isNotBlank)) { "账号缺少 UID" },
            region,
            timezone,
            lang,
            lastSyncAt,
        )
    }

    private fun readDatasetRecord(json: JsonReader, game: GameKind): GachaRecord {
        val values = linkedMapOf<String, String>()
        json.beginObject()
        while (json.hasNext()) {
            val name = json.nextName()
            values[name] = nextDatasetString(json, if (name == "count") "1" else "")
        }
        json.endObject()
        return GachaRecord(
            game = game,
            uid = requireNotNull(values["uid"]?.takeIf(String::isNotBlank)) { "记录缺少 UID" },
            id = requireNotNull(values["id"]?.takeIf(String::isNotBlank)) { "记录缺少 ID" },
            gachaType = values["gacha_type"].orEmpty(),
            uigfGachaType = values["uigf_gacha_type"].orEmpty(),
            gachaId = values["gacha_id"].orEmpty(),
            itemId = values["item_id"].orEmpty(),
            name = values["name"].orEmpty(),
            itemType = values["item_type"].orEmpty(),
            rankType = values["rank_type"].orEmpty(),
            count = values["count"] ?: "1",
            time = values["time"].orEmpty(),
            isUp = values["is_up"].orEmpty(),
        )
    }

    private data class DatasetPoolState(
        val uid: String,
        val poolType: String,
        val complete: Boolean,
    )

    private fun readDatasetPoolState(json: JsonReader): DatasetPoolState {
        var uid: String? = null
        var poolType: String? = null
        var complete = false
        json.beginObject()
        while (json.hasNext()) when (json.nextName()) {
            "uid" -> uid = json.nextString()
            "poolType" -> poolType = json.nextString()
            "historyComplete" -> complete = json.nextBoolean()
            else -> json.skipValue()
        }
        json.endObject()
        return DatasetPoolState(
            requireNotNull(uid?.takeIf(String::isNotBlank)) { "卡池状态缺少 UID" },
            requireNotNull(poolType?.takeIf(String::isNotBlank)) { "卡池状态缺少类型" },
            complete,
        )
    }

    private fun nextDatasetString(json: JsonReader, fallback: String): String =
        if (json.peek() == JsonToken.NULL) {
            json.nextNull()
            fallback
        } else {
            json.nextString()
        }

    private fun ensureDatasetAccount(db: SQLiteDatabase, game: GameKind, uid: String) {
        upsertAccount(db, GachaAccount(game, uid, "", 8, "zh-cn", 0L))
    }

    private fun upsertAccount(db: SQLiteDatabase, account: GachaAccount) {
        db.insertWithOnConflict(
            "accounts",
            null,
            ContentValues().apply {
                put("game", account.game.code)
                put("uid", account.uid)
                put("region", account.region)
                put("timezone", account.timezone)
                put("lang", account.lang)
                put("last_sync", account.lastSyncAt)
            },
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        db.execSQL(
            """
            UPDATE accounts SET
                region = CASE WHEN ? <> '' THEN ? ELSE region END,
                timezone = ?,
                lang = CASE WHEN ? <> '' THEN ? ELSE lang END,
                last_sync = MAX(last_sync, ?)
            WHERE game = ? AND uid = ?
            """.trimIndent(),
            arrayOf<Any>(
                account.region,
                account.region,
                account.timezone,
                account.lang,
                account.lang,
                account.lastSyncAt,
                account.game.code,
                account.uid,
            ),
        )
    }

    private fun markHistoryComplete(db: SQLiteDatabase, account: GachaAccount, poolType: String) {
        writePoolSyncState(db, account.game, account.uid, poolType, true)
    }

    private fun writePoolSyncState(
        db: SQLiteDatabase,
        game: GameKind,
        uid: String,
        poolType: String,
        complete: Boolean,
    ) {
        db.insertWithOnConflict(
            "pool_sync_state",
            null,
            ContentValues().apply {
                put("game", game.code)
                put("uid", uid)
                put("pool_type", poolType)
                put("history_complete", if (complete) 1 else 0)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    private fun GachaRecord.toValues() = ContentValues().apply {
        put("game", game.code)
        put("uid", uid)
        put("id", id)
        put("gacha_type", gachaType)
        put("uigf_gacha_type", uigfGachaType)
        put("gacha_id", gachaId)
        put("item_id", itemId)
        put("name", name)
        put("item_type", itemType)
        put("rank_type", rankType)
        put("count", count)
        put("time", time)
        put("is_up", isUp)
    }

    private fun android.database.Cursor.toRecord(game: GameKind) = GachaRecord(
        game = game,
        uid = getString(1),
        id = getString(2),
        gachaType = getString(3),
        uigfGachaType = getString(4),
        gachaId = getString(5),
        itemId = getString(6),
        name = getString(7),
        itemType = getString(8),
        rankType = getString(9),
        count = getString(10),
        time = getString(11),
        isUp = getString(12),
    )

    companion object {
        const val DATABASE_NAME = "gacha-analysis.db"
        private const val DATABASE_VERSION = 4
        private val RECORD_COLUMNS = arrayOf(
            "game",
            "uid",
            "id",
            "gacha_type",
            "uigf_gacha_type",
            "gacha_id",
            "item_id",
            "name",
            "item_type",
            "rank_type",
            "count",
            "time",
            "is_up",
        )

        private fun createAccountOrderIndex(db: SQLiteDatabase) {
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS records_account_order ON records(game, uid, time DESC, length(id) DESC, id DESC)",
            )
        }

        private fun createPoolSyncStateTable(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS pool_sync_state (
                    game TEXT NOT NULL,
                    uid TEXT NOT NULL,
                    pool_type TEXT NOT NULL,
                    history_complete INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (game, uid, pool_type)
                )
                """.trimIndent(),
            )
        }
    }
}
