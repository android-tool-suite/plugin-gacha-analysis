package com.androidtoolsuite.app.plugins.gacha

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Immutable, versioned banner metadata shipped with the plugin. Times are absolute instants. */
internal data class BannerSchedule(
    val game: GameKind,
    val poolType: String,
    val gachaId: String = "",
    val scheduleId: String = "",
    val startsAt: Instant,
    val endsAt: Instant,
    val upFiveStarNames: Set<String>,
)

internal data class BannerMetadata(
    val sourceVersion: String,
    val updatedAt: Instant,
    val schedules: List<BannerSchedule>,
)

/**
 * A source can be replaced by a downloaded, verified snapshot without making analysis depend on
 * the network. There is currently no stable official banner-schedule API for all three log APIs,
 * so the bundled version remains the always-available baseline.
 */
internal fun interface BannerMetadataSource {
    fun current(): BannerMetadata
}

internal object BundledBannerMetadata : BannerMetadataSource {
    override fun current() = BannerMetadata(
        sourceVersion = "bundled-2026.07.28-v1",
        updatedAt = Instant.parse("2026-07-28T00:00:00Z"),
        schedules = listOf(
            // 原神 1.3「鱼龙灯昼」刻晴角色活动祈愿；official announcement, UTC+8.
            BannerSchedule(
                game = GameKind.GENSHIN,
                poolType = "301",
                startsAt = Instant.parse("2021-02-17T10:00:00Z"),
                endsAt = Instant.parse("2021-03-02T06:59:59Z"),
                upFiveStarNames = setOf("刻晴"),
            ),
        ),
    )
}

internal class UpdatableBannerMetadataSource(
    private val bundled: BannerMetadata = BundledBannerMetadata.current(),
) : BannerMetadataSource {
    @Volatile private var update: BannerMetadata? = null

    override fun current(): BannerMetadata = update ?: bundled

    /** Callers persist a successfully downloaded snapshot; failed updates leave baseline intact. */
    fun install(metadata: BannerMetadata) {
        require(metadata.sourceVersion.isNotBlank()) { "卡池元数据缺少来源版本" }
        require(!metadata.updatedAt.isAfter(Instant.now())) { "卡池元数据更新时间无效" }
        update = metadata
    }
}

internal object BannerMatcher {
    private val recordTimeFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

    fun candidates(
        record: GachaRecord,
        serverTimezone: Int,
        schedules: List<BannerSchedule>,
    ): List<BannerSchedule> {
        val compatible = schedules.filter {
            it.game == record.game && it.poolType == record.displayPoolType
        }
        val identifiers = buildSet {
            record.gachaId.trim().takeIf(String::isNotEmpty)?.let(::add)
            record.scheduleId.trim().takeIf(String::isNotEmpty)?.let(::add)
        }
        if (identifiers.isNotEmpty()) {
            return compatible.filter { schedule ->
                schedule.gachaId in identifiers || schedule.scheduleId in identifiers
            }
        }
        val instant = runCatching {
            LocalDateTime.parse(record.time.trim(), recordTimeFormat)
                .toInstant(ZoneOffset.ofHours(serverTimezone.coerceIn(-18, 18)))
        }.getOrNull() ?: return emptyList()
        // API timestamps have second precision: both published boundary instants are inclusive.
        return compatible.filter { !instant.isBefore(it.startsAt) && !instant.isAfter(it.endsAt) }
    }
}
