package com.androidtoolsuite.app.plugins.gacha

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

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
                schedule_id TEXT NOT NULL DEFAULT '',
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
        if (oldVersion < 5) db.execSQL("ALTER TABLE records ADD COLUMN schedule_id TEXT NOT NULL DEFAULT ''")
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
        put("schedule_id", scheduleId)
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
        scheduleId = getString(6),
        itemId = getString(7),
        name = getString(8),
        itemType = getString(9),
        rankType = getString(10),
        count = getString(11),
        time = getString(12),
        isUp = getString(13),
    )

    companion object {
        private const val DATABASE_NAME = "gacha-analysis.db"
        private const val DATABASE_VERSION = 5
        private val RECORD_COLUMNS = arrayOf(
            "game",
            "uid",
            "id",
            "gacha_type",
            "uigf_gacha_type",
            "gacha_id",
            "schedule_id",
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
