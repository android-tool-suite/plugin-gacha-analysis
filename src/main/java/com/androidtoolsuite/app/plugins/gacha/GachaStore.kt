package com.androidtoolsuite.app.plugins.gacha

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.JsonWriter
import java.io.FilterOutputStream
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
        db.insertWithOnConflict(
            "pool_sync_state",
            null,
            ContentValues().apply {
                put("game", account.game.code)
                put("uid", account.uid)
                put("pool_type", poolType)
                put("history_complete", 1)
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
