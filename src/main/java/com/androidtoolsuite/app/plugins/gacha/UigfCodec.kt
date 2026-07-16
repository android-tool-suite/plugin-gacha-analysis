package com.androidtoolsuite.app.plugins.gacha

import org.json.JSONArray
import org.json.JSONObject

internal object UigfCodec {
    fun decode(raw: String): List<GachaBundle> {
        val root = JSONObject(raw)
        val info = root.optJSONObject("info") ?: JSONObject()
        val exportTimestamp = info.optString("export_timestamp").toLongOrNull()?.times(1000L)
            ?: System.currentTimeMillis()
        val bundles = mutableListOf<GachaBundle>()
        decodeGameArray(root.optJSONArray("hk4e"), GameKind.GENSHIN, exportTimestamp, bundles)
        decodeGameArray(root.optJSONArray("hkrpg"), GameKind.STAR_RAIL, exportTimestamp, bundles)
        decodeBeyondArray(root.optJSONArray("hk4e_ugc"), exportTimestamp, bundles)
        if (bundles.isEmpty() && root.optJSONArray("list") != null) {
            bundles += decodeLegacy(root, exportTimestamp)
        }
        require(bundles.isNotEmpty()) { "文件中没有可导入的原神或星穹铁道记录" }
        return consolidate(bundles)
    }

    fun encode(bundles: List<GachaBundle>, appVersion: String): String {
        val root = JSONObject()
        root.put(
            "info",
            JSONObject()
                .put("export_timestamp", System.currentTimeMillis() / 1000L)
                .put("export_app", "Android Tool Suite · Gacha Analysis")
                .put("export_app_version", appVersion)
                .put("version", "v4.2"),
        )
        val genshin = bundles.filter { it.account.game == GameKind.GENSHIN }
        val regularGenshin = genshin.mapNotNull { bundle ->
            bundle.copy(records = bundle.records.filterNot(::isBeyondRecord)).takeIf { it.records.isNotEmpty() }
        }
        if (regularGenshin.isNotEmpty()) {
            root.put("hk4e", JSONArray().apply { regularGenshin.forEach { put(encodeBundle(it)) } })
        }
        val beyond = genshin.mapNotNull { bundle ->
            bundle.copy(records = bundle.records.filter(::isBeyondRecord)).takeIf { it.records.isNotEmpty() }
        }
        if (beyond.isNotEmpty()) {
            root.put("hk4e_ugc", JSONArray().apply { beyond.forEach { put(encodeBeyondBundle(it)) } })
        }
        val starRail = bundles.filter { it.account.game == GameKind.STAR_RAIL && it.records.isNotEmpty() }
        if (starRail.isNotEmpty()) {
            root.put("hkrpg", JSONArray().apply { starRail.forEach { put(encodeBundle(it)) } })
        }
        return root.toString(2)
    }

    private fun decodeBeyondArray(
        array: JSONArray?,
        exportTimestamp: Long,
        output: MutableList<GachaBundle>,
    ) {
        if (array == null) return
        for (index in 0 until array.length()) {
            val json = array.optJSONObject(index) ?: continue
            val uid = json.optString("uid")
            if (uid.isBlank()) continue
            val records = LinkedHashMap<String, GachaRecord>()
            val list = json.optJSONArray("list") ?: JSONArray()
            for (itemIndex in 0 until list.length()) {
                val item = list.optJSONObject(itemIndex) ?: continue
                val id = item.optString("id")
                val opType = item.optString("op_gacha_type")
                val time = item.optString("time")
                if (id.isBlank() || opType.isBlank() || time.isBlank()) continue
                records[id] = GachaRecord(
                    game = GameKind.GENSHIN,
                    uid = uid,
                    id = id,
                    gachaType = opType,
                    uigfGachaType = GameKind.GENSHIN.normalizedPoolType(opType),
                    gachaId = item.optString("schedule_id"),
                    itemId = item.optString("item_id"),
                    name = item.optString("item_name"),
                    itemType = item.optString("item_type"),
                    rankType = item.optString("rank_type"),
                    count = "1",
                    time = time,
                    isUp = item.optString("is_up"),
                )
            }
            output += GachaBundle(
                GachaAccount(
                    GameKind.GENSHIN,
                    uid,
                    "",
                    json.optInt("timezone", 8),
                    json.optString("lang", "zh-cn"),
                    exportTimestamp,
                ),
                records.values.toList(),
            )
        }
    }

    private fun decodeGameArray(
        array: JSONArray?,
        game: GameKind,
        exportTimestamp: Long,
        output: MutableList<GachaBundle>,
    ) {
        if (array == null) return
        for (index in 0 until array.length()) {
            val json = array.optJSONObject(index) ?: continue
            val uid = json.optString("uid")
            if (uid.isBlank()) continue
            val timezone = json.optInt("timezone", 8)
            val lang = json.optString("lang", "zh-cn")
            val records = decodeRecords(json.optJSONArray("list"), game, uid)
            output += GachaBundle(
                GachaAccount(game, uid, "", timezone, lang, exportTimestamp),
                records,
            )
        }
    }

    private fun decodeLegacy(root: JSONObject, exportTimestamp: Long): GachaBundle {
        val info = root.optJSONObject("info") ?: JSONObject()
        val list = root.optJSONArray("list") ?: JSONArray()
        val first = list.optJSONObject(0) ?: JSONObject()
        val isStarRail = info.has("srgf_version") || (first.has("gacha_id") && !first.has("uigf_gacha_type"))
        val game = if (isStarRail) GameKind.STAR_RAIL else GameKind.GENSHIN
        val uid = info.optString("uid").ifBlank { first.optString("uid") }
        require(uid.isNotBlank()) { "旧版文件缺少 UID" }
        val timezone = info.optInt("region_time_zone", info.optInt("timezone", 8))
        val lang = info.optString("lang", "zh-cn")
        return GachaBundle(
            GachaAccount(game, uid, "", timezone, lang, exportTimestamp),
            decodeRecords(list, game, uid),
        )
    }

    private fun decodeRecords(array: JSONArray?, game: GameKind, uid: String): List<GachaRecord> {
        if (array == null) return emptyList()
        val records = LinkedHashMap<String, GachaRecord>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString("id")
            val gachaType = item.optString("gacha_type")
            val time = item.optString("time")
            if (id.isBlank() || gachaType.isBlank() || time.isBlank()) continue
            records[id] = GachaRecord(
                game = game,
                uid = item.optString("uid", uid).ifBlank { uid },
                id = id,
                gachaType = gachaType,
                uigfGachaType = if (game == GameKind.GENSHIN) {
                    item.optString("uigf_gacha_type", game.normalizedPoolType(gachaType))
                } else {
                    ""
                },
                gachaId = item.optString("gacha_id"),
                itemId = item.optString("item_id"),
                name = item.optString("name"),
                itemType = item.optString("item_type"),
                rankType = item.optString("rank_type"),
                count = item.optString("count", "1"),
                time = time,
                isUp = item.optString("is_up"),
            )
        }
        return records.values.toList()
    }

    private fun encodeBundle(bundle: GachaBundle): JSONObject = JSONObject()
        .put("uid", bundle.account.uid)
        .put("timezone", bundle.account.timezone)
        .put("lang", bundle.account.lang)
        .put(
            "list",
            JSONArray().apply {
                bundle.records.sortedWith(GachaAnalysis.recordOrder).forEach { record ->
                    put(encodeRecord(record))
                }
            },
        )

    private fun encodeRecord(record: GachaRecord): JSONObject = JSONObject().apply {
        if (record.game == GameKind.GENSHIN) {
            put("uigf_gacha_type", record.game.normalizedPoolType(record.uigfGachaType.ifBlank { record.gachaType }))
        } else {
            put("gacha_id", record.gachaId)
        }
        put("gacha_type", record.gachaType)
        put("item_id", record.itemId)
        put("count", record.count.ifBlank { "1" })
        put("time", record.time)
        put("name", record.name)
        put("item_type", record.itemType)
        put("rank_type", record.rankType)
        put("id", record.id)
    }

    private fun encodeBeyondBundle(bundle: GachaBundle): JSONObject = JSONObject()
        .put("uid", bundle.account.uid)
        .put("timezone", bundle.account.timezone)
        .put("lang", bundle.account.lang)
        .put(
            "list",
            JSONArray().apply {
                bundle.records.sortedWith(GachaAnalysis.recordOrder).forEach { record ->
                    put(
                        JSONObject()
                            .put("id", record.id)
                            .put("schedule_id", record.gachaId.ifBlank { "0" })
                            .put("item_type", record.itemType)
                            .put("item_id", record.itemId)
                            .put("item_name", record.name)
                            .put("rank_type", record.rankType)
                            .put("time", record.time)
                            .put("op_gacha_type", record.gachaType),
                    )
                }
            },
        )

    private fun isBeyondRecord(record: GachaRecord): Boolean =
        record.game == GameKind.GENSHIN && record.game.pool(record.displayPoolType).isBeyond

    private fun consolidate(bundles: List<GachaBundle>): List<GachaBundle> = bundles
        .groupBy { it.account.key }
        .values
        .map { sameAccount ->
            val newest = sameAccount.maxBy { it.account.lastSyncAt }.account
            val records = LinkedHashMap<String, GachaRecord>()
            sameAccount.forEach { bundle -> bundle.records.forEach { records.putIfAbsent(it.id, it) } }
            GachaBundle(newest, records.values.toList())
        }
}
