package com.androidtoolsuite.app.plugins.gacha

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

internal enum class BannerHistorySource(
    val preferenceId: String,
    val label: String,
    val description: String,
    private val games: Set<GameKind>,
) {
    RECORD_FIELD(
        preferenceId = "record-field",
        label = "记录原始字段",
        description = "使用导入或接口记录自带的 is_up 结果。",
        games = GameKind.entries.toSet(),
    ),
    PAIMON_MOE(
        preferenceId = "paimon-moe",
        label = "Paimon.moe",
        description = "按服务器时间匹配原神角色与武器活动祈愿历史。",
        games = setOf(GameKind.GENSHIN),
    ),
    STAR_RAIL_STATION(
        preferenceId = "star-rail-station",
        label = "Star Rail Station",
        description = "按跃迁 ID 匹配星铁角色、光锥与联动跃迁历史。",
        games = setOf(GameKind.STAR_RAIL),
    ),
    LOCAL_RULES(
        preferenceId = "local-rules",
        label = "本地名单推断",
        description = "使用内置常驻名单和当前账号的常驻记录兜底。",
        games = GameKind.entries.toSet(),
    );

    fun supports(game: GameKind): Boolean = game in games

    companion object {
        fun availableFor(game: GameKind): List<BannerHistorySource> = entries.filter { it.supports(game) }

        fun defaultsFor(game: GameKind): Set<BannerHistorySource> = availableFor(game).toSet()

        fun fromPreferenceIds(ids: Set<String>, game: GameKind): Set<BannerHistorySource> = ids
            .mapNotNull { id -> entries.firstOrNull { it.preferenceId == id && it.supports(game) } }
            .toSet()
    }
}

internal data class BannerSchedule(
    val source: BannerHistorySource,
    val game: GameKind,
    val poolType: String,
    val id: String,
    val startsAtLocal: String?,
    val endsAtLocal: String?,
    val timezoneDependentStart: Boolean,
    val timezoneDependentEnd: Boolean,
    val startsAtEpochSeconds: Long?,
    val endsAtEpochSeconds: Long?,
    val featuredItemIds: Set<String>,
) {
    companion object {
        fun localTime(
            source: BannerHistorySource,
            game: GameKind,
            poolType: String,
            id: String,
            startsAt: String,
            endsAt: String,
            timezoneDependentStart: Boolean,
            timezoneDependentEnd: Boolean,
            featuredItemIds: Set<String>,
        ): BannerSchedule = BannerSchedule(
            source = source,
            game = game,
            poolType = poolType,
            id = id,
            startsAtLocal = startsAt,
            endsAtLocal = endsAt,
            timezoneDependentStart = timezoneDependentStart,
            timezoneDependentEnd = timezoneDependentEnd,
            startsAtEpochSeconds = null,
            endsAtEpochSeconds = null,
            featuredItemIds = featuredItemIds,
        )

        fun exactId(
            source: BannerHistorySource,
            game: GameKind,
            poolType: String,
            id: String,
            startsAtEpochSeconds: Long,
            endsAtEpochSeconds: Long,
            featuredItemIds: Set<String>,
        ): BannerSchedule = BannerSchedule(
            source = source,
            game = game,
            poolType = poolType,
            id = id,
            startsAtLocal = null,
            endsAtLocal = null,
            timezoneDependentStart = false,
            timezoneDependentEnd = false,
            startsAtEpochSeconds = startsAtEpochSeconds,
            endsAtEpochSeconds = endsAtEpochSeconds,
            featuredItemIds = featuredItemIds,
        )
    }
}

internal class BannerHistoryIndex(
    schedules: List<BannerSchedule>,
) {
    private val exactIdSchedules = schedules
        .filter { it.startsAtEpochSeconds != null }
        .associateBy { ExactIdKey(it.source, it.game, it.poolType, it.id) }
    private val localTimeSchedules = schedules
        .filter { it.startsAtLocal != null }
        .groupBy { LocalTimeKey(it.source, it.game, it.poolType) }

    fun isFeatured(
        source: BannerHistorySource,
        record: GachaRecord,
        accountTimezone: Int,
    ): Boolean? {
        if (!source.supports(record.game) || record.itemId.isBlank()) return null
        val poolType = record.displayPoolType
        val exact = exactIdSchedules[ExactIdKey(source, record.game, poolType, record.gachaId)]
        if (exact != null) return record.itemId in exact.featuredItemIds

        if (source != BannerHistorySource.PAIMON_MOE) return null
        val recordTime = parseLocalTimestamp(record.time) ?: return null
        val schedule = localTimeSchedules[LocalTimeKey(source, record.game, poolType)]
            .orEmpty()
            .firstOrNull { it.containsLocalTime(recordTime, accountTimezone) }
            ?: return null
        return record.itemId in schedule.featuredItemIds
    }

    private fun BannerSchedule.containsLocalTime(recordTime: Long, accountTimezone: Int): Boolean {
        val rawStart = startsAtLocal?.let(::parseLocalTimestamp) ?: return false
        val rawEnd = endsAtLocal?.let(::parseLocalTimestamp) ?: return false
        val startAdjustment = if (timezoneDependentStart) ASIA_TIMEZONE - accountTimezone else 0
        val endAdjustment = if (timezoneDependentEnd) ASIA_TIMEZONE - accountTimezone else 0
        val adjustedStart = rawStart - startAdjustment * HOUR_MILLIS
        val adjustedEnd = rawEnd - endAdjustment * HOUR_MILLIS
        return recordTime >= adjustedStart && recordTime < adjustedEnd
    }

    private data class ExactIdKey(
        val source: BannerHistorySource,
        val game: GameKind,
        val poolType: String,
        val id: String,
    )

    private data class LocalTimeKey(
        val source: BannerHistorySource,
        val game: GameKind,
        val poolType: String,
    )

    companion object {
        val EMPTY = BannerHistoryIndex(emptyList())
        val EMBEDDED by lazy(LazyThreadSafetyMode.PUBLICATION) { BannerHistoryIndex(EmbeddedBannerHistory.schedules) }

        private const val ASIA_TIMEZONE = 8
        private const val HOUR_MILLIS = 60L * 60L * 1000L
        private val timestampParser = object : ThreadLocal<SimpleDateFormat>() {
            override fun initialValue(): SimpleDateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).apply {
                isLenient = false
                timeZone = TimeZone.getTimeZone("UTC")
            }
        }

        private fun parseLocalTimestamp(value: String): Long? = try {
            timestampParser.get()?.parse(value)?.time
        } catch (_: Throwable) {
            null
        }
    }
}

internal fun GachaRecord.explicitIsFeatured(): Boolean? = when (isUp.trim().lowercase(Locale.ROOT)) {
    "1", "true", "up", "yes" -> true
    "0", "false", "not_up", "not-up", "no" -> false
    else -> null
}
