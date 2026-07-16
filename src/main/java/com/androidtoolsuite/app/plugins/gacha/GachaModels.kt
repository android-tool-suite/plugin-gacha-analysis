package com.androidtoolsuite.app.plugins.gacha

import java.util.Locale

internal enum class GameKind(
    val code: String,
    val label: String,
    val bizPrefix: String,
    val cnApiBase: String,
    val overseasApiBase: String,
    val apiPath: String,
    val cloudUrl: String,
    val pools: List<GachaPool>,
) {
    GENSHIN(
        code = "hk4e",
        label = "原神",
        bizPrefix = "hk4e_",
        cnApiBase = "https://public-operation-hk4e.mihoyo.com",
        overseasApiBase = "https://public-operation-hk4e-sg.hoyoverse.com",
        apiPath = "/gacha_info/api/getGachaLog",
        cloudUrl = "https://ys.mihoyo.com/cloud/",
        pools = listOf(
            GachaPool("301", "角色活动祈愿", 90, tracksUp = true),
            GachaPool("302", "武器活动祈愿", 80, tracksUp = true),
            GachaPool("500", "集录祈愿", 90),
            GachaPool("2000", "千星奇域·活动颂愿", 70, isBeyond = true),
            GachaPool("1000", "千星奇域·常驻颂愿", 70, isBeyond = true, targetRarity = 4),
            GachaPool("200", "常驻祈愿", 90),
            GachaPool("100", "新手祈愿", 20),
        ),
    ),
    STAR_RAIL(
        code = "hkrpg",
        label = "星穹铁道",
        bizPrefix = "hkrpg_",
        cnApiBase = "https://public-operation-hkrpg.mihoyo.com",
        overseasApiBase = "https://public-operation-hkrpg-sg.hoyoverse.com",
        apiPath = "/common/gacha_record/api/getGachaLog",
        cloudUrl = "https://sr.mihoyo.com/cloud/",
        pools = listOf(
            GachaPool("11", "角色活动跃迁", 90, tracksUp = true),
            GachaPool("12", "光锥活动跃迁", 80, tracksUp = true),
            GachaPool("21", "角色联动跃迁", 90, tracksUp = true),
            GachaPool("22", "光锥联动跃迁", 80, tracksUp = true),
            GachaPool("1", "常驻跃迁", 90),
            GachaPool("2", "新手跃迁", 50),
        ),
    );

    fun normalizedPoolType(raw: String): String = when {
        this == GENSHIN && raw == "400" -> "301"
        this == GENSHIN && raw in BEYOND_EVENT_TYPES -> "2000"
        else -> raw
    }

    fun pool(raw: String): GachaPool = pools.firstOrNull { it.type == normalizedPoolType(raw) }
        ?: GachaPool(normalizedPoolType(raw), "未知卡池 ${normalizedPoolType(raw)}", 90)

    fun apiPathFor(poolType: String): String = when {
        this == GENSHIN && pool(poolType).isBeyond -> "/gacha_info/api/getBeyondGachaLog"
        this == STAR_RAIL && poolType in setOf("21", "22") -> "/common/gacha_record/api/getLdGachaLog"
        else -> apiPath
    }

    companion object {
        private val BEYOND_EVENT_TYPES = setOf("20011", "20012", "20021", "20022")

        fun fromCode(code: String): GameKind? = entries.firstOrNull { it.code == code }
        fun fromBiz(gameBiz: String): GameKind? = entries.firstOrNull { gameBiz.startsWith(it.bizPrefix) }
    }
}

internal data class GachaPool(
    val type: String,
    val label: String,
    val hardPity: Int,
    val tracksUp: Boolean = false,
    val isBeyond: Boolean = false,
    val targetRarity: Int = 5,
) {
    val apiPageSize: Int get() = if (isBeyond) 5 else 20
    val targetLabel: String get() = "${targetRarity}星"
}

internal data class GachaAccount(
    val game: GameKind,
    val uid: String,
    val region: String,
    val timezone: Int,
    val lang: String,
    val lastSyncAt: Long,
) {
    val key: String get() = "${game.code}:$uid"
    val displayName: String get() = "${game.label} · $uid"
}

internal data class GachaRecord(
    val game: GameKind,
    val uid: String,
    val id: String,
    val gachaType: String,
    val uigfGachaType: String,
    val gachaId: String,
    val itemId: String,
    val name: String,
    val itemType: String,
    val rankType: String,
    val count: String,
    val time: String,
    val isUp: String = "",
) {
    val displayPoolType: String get() = game.normalizedPoolType(uigfGachaType.ifBlank { gachaType })
    val rarity: Int get() = rankType.toIntOrNull() ?: 0
}

internal data class TargetPull(
    val record: GachaRecord,
    val pity: Int,
    val isLoss: Boolean? = null,
) {
    val luck: LuckGrade get() = LuckGrade.forPull(pity, record.game.pool(record.displayPoolType).hardPity)
}

internal enum class LuckGrade(val label: String) {
    SUPER_LUCKY("超欧"),
    LUCKY("欧"),
    NORMAL("正常"),
    UNLUCKY("非"),
    VERY_UNLUCKY("超非");

    companion object {
        fun forPull(pity: Int, hardPity: Int): LuckGrade {
            val ratio = pity.toDouble() / hardPity.coerceAtLeast(1)
            return when {
                ratio <= 0.30 -> SUPER_LUCKY
                ratio <= 0.60 -> LUCKY
                ratio <= 0.82 -> NORMAL
                ratio <= 0.94 -> UNLUCKY
                else -> VERY_UNLUCKY
            }
        }
    }
}

internal data class PoolStats(
    val pool: GachaPool,
    val total: Int,
    val count3: Int,
    val count4: Int,
    val count5: Int,
    val targetCount: Int,
    val currentPity: Int,
    val averageTargetPity: Double,
    val upCount: Int,
    val lossCount: Int,
    val averageUpPity: Double,
    val targetPulls: List<TargetPull>,
) {
    fun rate(count: Int): String = if (total == 0) "0%" else String.format(Locale.ROOT, "%.2f%%", count * 100.0 / total)

    val averageLabel: String get() = if (pool.tracksUp) "平均 UP" else "${pool.targetLabel}平均"
    val displayedAverage: Double get() = if (pool.tracksUp) averageUpPity else averageTargetPity

    fun countForRarity(rarity: Int): Int = when (rarity) {
        3 -> count3
        4 -> count4
        5 -> count5
        else -> 0
    }
}

internal data class LocalAccountSnapshot(
    val records: List<GachaRecord>,
    val poolStats: List<PoolStats>,
    val pityByRecordId: Map<String, Int>,
    val customLossNames: Set<String> = emptySet(),
    val customLossCandidates: List<String> = emptyList(),
)

internal object GachaAnalysis {
    fun calculate(
        game: GameKind,
        records: List<GachaRecord>,
        customLossNames: Set<String> = emptySet(),
    ): List<PoolStats> = snapshot(game, records, customLossNames).poolStats

    fun snapshot(
        game: GameKind,
        records: List<GachaRecord>,
        customLossNames: Set<String> = emptySet(),
    ): LocalAccountSnapshot {
        val grouped = records.groupBy { it.displayPoolType }
        val observedPermanentFiveStars = records.asSequence()
            .filter { it.rarity == 5 && it.displayPoolType == permanentPoolType(game) }
            .map { it.name }
            .filter(String::isNotBlank)
            .toSet()
        val customLossCandidates = if (game == GameKind.STAR_RAIL) {
            (records.asSequence()
                .filter { it.rarity == 5 && it.displayPoolType in STAR_RAIL_CHARACTER_EVENT_POOLS }
                .map(GachaRecord::name)
                .filter { it.isNotBlank() && it !in STAR_RAIL_STANDARD_FIVE_STARS }
                .toSet() + customLossNames).sorted()
        } else {
            emptyList()
        }
        val pityByRecordId = HashMap<String, Int>(records.size)
        val stats = game.pools.mapNotNull { pool ->
            val poolRecords = grouped[pool.type].orEmpty().sortedWith(recordOrder)
            if (poolRecords.isEmpty()) return@mapNotNull null
            var pity = 0
            var count3 = 0
            var count4 = 0
            var count5 = 0
            val targetPulls = mutableListOf<TargetPull>()
            poolRecords.forEach { record ->
                pity += 1
                pityByRecordId[record.id] = pity
                when (record.rarity) {
                    3 -> count3 += 1
                    4 -> count4 += 1
                    5 -> count5 += 1
                }
                if (record.rarity == pool.targetRarity) {
                    targetPulls += TargetPull(
                        record = record,
                        pity = pity,
                        isLoss = if (pool.tracksUp) {
                            isLossFiveStar(record, observedPermanentFiveStars, customLossNames)
                        } else {
                            null
                        },
                    )
                    pity = 0
                }
            }
            val lossCount = targetPulls.count { it.isLoss == true }
            val upCount = targetPulls.count { it.isLoss == false }
            PoolStats(
                pool = pool,
                total = poolRecords.size,
                count3 = count3,
                count4 = count4,
                count5 = count5,
                targetCount = targetPulls.size,
                currentPity = pity,
                averageTargetPity = targetPulls.map { it.pity }.average().takeUnless(Double::isNaN) ?: 0.0,
                upCount = upCount,
                lossCount = lossCount,
                averageUpPity = if (upCount == 0) 0.0 else (poolRecords.size - pity).toDouble() / upCount,
                targetPulls = targetPulls.asReversed(),
            )
        }
        val knownPoolTypes = game.pools.mapTo(HashSet()) { it.type }
        grouped.filterKeys { it !in knownPoolTypes }.values.forEach { group ->
            var pity = 0
            group.sortedWith(recordOrder).forEach { record ->
                pity += 1
                pityByRecordId[record.id] = pity
                if (record.rarity == 5) pity = 0
            }
        }
        return LocalAccountSnapshot(records, stats, pityByRecordId, customLossNames, customLossCandidates)
    }

    fun overallLuck(stats: List<PoolStats>): String {
        val tracked = stats.filter { it.pool.tracksUp && it.upCount > 0 }
        if (tracked.isEmpty()) return "等待第一份 UP 记录"
        val completedPulls = tracked.sumOf { it.total - it.currentPity }
        val upCount = tracked.sumOf { it.upCount }
        val weightedHardPity = tracked.sumOf { it.pool.hardPity * it.upCount }.toDouble() / upCount
        val ratio = (completedPulls.toDouble() / upCount) / weightedHardPity
        return when {
            ratio <= 0.55 -> "天选欧洲人"
            ratio <= 0.80 -> "稳稳的欧洲人"
            ratio <= 1.05 -> "薛定谔的欧洲人"
            ratio <= 1.35 -> "非洲旅行者"
            else -> "大非酋也会转运"
        }
    }

    val recordOrder: Comparator<GachaRecord> = Comparator { left, right ->
        val time = left.time.compareTo(right.time)
        if (time != 0) time else compareDecimalIds(left.id, right.id)
    }

    private fun compareDecimalIds(left: String, right: String): Int {
        val normalizedLeft = left.trimStart('0').ifBlank { "0" }
        val normalizedRight = right.trimStart('0').ifBlank { "0" }
        val length = normalizedLeft.length.compareTo(normalizedRight.length)
        return if (length != 0) length else normalizedLeft.compareTo(normalizedRight)
    }

    private fun permanentPoolType(game: GameKind): String = if (game == GameKind.GENSHIN) "200" else "1"

    private fun isLossFiveStar(record: GachaRecord, observed: Set<String>, customLossNames: Set<String>): Boolean {
        if (record.name in customLossNames) return true
        if (record.name in observed) return true
        return record.name in when (record.game) {
            GameKind.GENSHIN -> GENSHIN_STANDARD_FIVE_STARS
            GameKind.STAR_RAIL -> STAR_RAIL_STANDARD_FIVE_STARS
        }
    }

    private val GENSHIN_STANDARD_FIVE_STARS = setOf(
        "琴", "迪卢克", "莫娜", "七七", "刻晴", "提纳里", "迪希雅", "梦见月瑞希",
        "阿莫斯之弓", "天空之翼", "四风原典", "天空之卷", "狼的末路", "天空之傲",
        "和璞鸢", "天空之脊", "风鹰剑", "天空之刃",
    )

    private val STAR_RAIL_STANDARD_FIVE_STARS = setOf(
        "姬子", "瓦尔特", "布洛妮娅", "杰帕德", "克拉拉", "白露", "彦卿",
        "银河铁道之夜", "无可取代的东西", "但战斗还未结束", "以世界之名",
        "制胜的瞬间", "如泥酣眠", "时节不居",
    )

    private val STAR_RAIL_CHARACTER_EVENT_POOLS = setOf("11", "21")
}

internal enum class GachaPage(val label: String) {
    OVERVIEW("概览"),
    RECORDS("记录"),
    ACQUIRE("获取"),
    DATA("数据"),
}

internal enum class BrowserMode {
    CLOUD_GENSHIN,
    CLOUD_STAR_RAIL,
}

internal data class MihoyoRole(
    val game: GameKind,
    val uid: String,
    val region: String,
    val regionName: String,
    val level: Int,
    val nickname: String,
    val gameBiz: String,
)

internal fun MihoyoRole.supportsMihoyoGachaLink(): Boolean = game == GameKind.GENSHIN

internal const val MIHOYO_STAR_RAIL_UNSUPPORTED =
    "星穹铁道不支持通过米游社登录状态生成可用抽卡链接，请改用 Shizuku、官方云游戏或手动粘贴链接"

internal data class GachaUiState(
    val page: GachaPage = GachaPage.OVERVIEW,
    val accounts: List<GachaAccount> = emptyList(),
    val selectedAccountKey: String? = null,
    val records: List<GachaRecord> = emptyList(),
    val poolStats: List<PoolStats> = emptyList(),
    val pityByRecordId: Map<String, Int> = emptyMap(),
    val selectedPoolType: String = "all",
    val selectedRarity: Int = 0,
    val busy: Boolean = false,
    val progress: String = "",
    val message: String? = null,
    val error: String? = null,
    val hasLink: Boolean = false,
    val linkSummary: String = "尚未获取链接",
    val shizukuCapturing: Boolean = false,
    val browserMode: BrowserMode? = null,
    val mihoyoQrUrl: String? = null,
    val mihoyoQrStatus: String = "",
    val mihoyoRoles: List<MihoyoRole> = emptyList(),
    val mihoyoSessionSaved: Boolean = false,
    val customLossNames: Set<String> = emptySet(),
    val customLossCandidates: List<String> = emptyList(),
    val hostRevision: Int = 0,
)

internal fun GachaUiState.withLocalSnapshot(
    accounts: List<GachaAccount>,
    account: GachaAccount?,
    snapshot: LocalAccountSnapshot?,
): GachaUiState = copy(
    accounts = accounts,
    selectedAccountKey = account?.key,
    records = snapshot?.records.orEmpty(),
    poolStats = snapshot?.poolStats.orEmpty(),
    pityByRecordId = snapshot?.pityByRecordId.orEmpty(),
    customLossNames = snapshot?.customLossNames.orEmpty(),
    customLossCandidates = snapshot?.customLossCandidates.orEmpty(),
    selectedPoolType = "all",
    selectedRarity = 0,
    busy = false,
    progress = "",
    message = null,
    error = null,
)
