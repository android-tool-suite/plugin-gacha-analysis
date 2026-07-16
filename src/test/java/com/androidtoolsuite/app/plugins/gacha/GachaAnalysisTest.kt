package com.androidtoolsuite.app.plugins.gacha

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import org.json.JSONObject

class GachaAnalysisTest {
    @Test
    fun `character wish 400 and 301 share pity`() {
        val records = (1..12).map { index ->
            record(
                id = index.toString(),
                type = if (index <= 5) "400" else "301",
                rarity = if (index == 8) 5 else 3,
            )
        }
        val stats = GachaAnalysis.calculate(GameKind.GENSHIN, records).single()
        assertEquals("301", stats.pool.type)
        assertEquals(8, stats.targetPulls.single().pity)
        assertEquals(4, stats.currentPity)
    }

    @Test
    fun `uigf v4 round trip preserves both games`() {
        val genshinAccount = GachaAccount(GameKind.GENSHIN, "100000001", "cn_gf01", 8, "zh-cn", 1)
        val railAccount = GachaAccount(GameKind.STAR_RAIL, "100000002", "prod_gf_cn", 8, "zh-cn", 1)
        val text = UigfCodec.encode(
            listOf(
                GachaBundle(genshinAccount, listOf(record("9223372036854775809", "301", 5))),
                GachaBundle(railAccount, listOf(record("9223372036854775810", "11", 5, GameKind.STAR_RAIL, railAccount.uid))),
            ),
            "1.0.0",
        )
        val decoded = UigfCodec.decode(text)
        assertEquals(2, decoded.size)
        assertTrue(decoded.any { it.account.game == GameKind.GENSHIN && it.records.single().id == "9223372036854775809" })
        assertTrue(decoded.any { it.account.game == GameKind.STAR_RAIL && it.records.single().id == "9223372036854775810" })
    }

    @Test
    fun `uigf merge input removes duplicate ids`() {
        val raw = """
            {
              "info":{"export_timestamp":1,"export_app":"test","export_app_version":"1","version":"v4.2"},
              "hk4e":[
                {"uid":"100","timezone":8,"list":[{"uigf_gacha_type":"301","gacha_type":"301","item_id":"1","time":"2026-01-01 00:00:00","id":"9"}]},
                {"uid":"100","timezone":8,"list":[{"uigf_gacha_type":"301","gacha_type":"301","item_id":"1","time":"2026-01-01 00:00:00","id":"9"}]}
              ]
            }
        """.trimIndent()
        val bundle = UigfCodec.decode(raw).single()
        assertEquals(1, bundle.records.size)
    }

    @Test
    fun `link parser normalizes html escaped authkey and star rail collaboration endpoint`() {
        val link = GachaLinkParser.parse(
            "https://webstatic.mihoyo.com/?authkey_ver=1&amp;authkey=a%2Bb%3D&amp;region=prod_gf_cn&amp;game_biz=hkrpg_cn",
        )
        assertEquals(GameKind.STAR_RAIL, link.game)
        assertEquals("a+b=", link.parameters["authkey"])
        assertTrue(link.requestUrl("11").startsWith(GameKind.STAR_RAIL.cnApiBase))
        assertTrue(link.requestUrl("21").contains("getLdGachaLog"))
    }

    @Test
    fun `pasted retired mihoyo star rail link routes to active public gateway`() {
        val link = GachaLinkParser.parse(
            "https://api-takumi.mihoyo.com/common/gacha_record/api/getGachaLog?authkey=test&region=prod_gf_cn&game_biz=hkrpg_cn",
        )

        assertTrue(link.requestUrl("11").startsWith(GameKind.STAR_RAIL.cnApiBase))
    }

    @Test
    fun `mihoyo generated link only supports genshin roles`() {
        val railRole = MihoyoRole(
            game = GameKind.STAR_RAIL,
            uid = "100000002",
            region = "prod_gf_cn",
            regionName = "星穹列车",
            level = 70,
            nickname = "测试",
            gameBiz = "hkrpg_cn",
        )
        val genshinRole = railRole.copy(
            game = GameKind.GENSHIN,
            region = "cn_gf01",
            gameBiz = "hk4e_cn",
        )

        assertFalse(railRole.supportsMihoyoGachaLink())
        assertThrows(IllegalArgumentException::class.java) {
            buildMihoyoGachaLink(railRole, "test-authkey", timestampSeconds = 1_700_000_000L)
        }

        assertTrue(genshinRole.supportsMihoyoGachaLink())
        val link = buildMihoyoGachaLink(genshinRole, "test-authkey", timestampSeconds = 1_700_000_000L)

        assertTrue(link.requestUrl("301").startsWith(GameKind.GENSHIN.cnApiBase))
        assertEquals("301", link.parameters["default_gacha_type"])
        assertEquals("1700000000", link.parameters["timestamp"])
        assertEquals("Android", link.parameters["os_system"])
        assertEquals("100000002", link.uidHint)
        assertEquals("https://api-takumi.miyoushe.com/binding/api/genAuthKey", MIHOYO_AUTHKEY_API)
    }

    @Test
    fun `finishing a local snapshot clears loading and reuses precomputed pity`() {
        val account = GachaAccount(GameKind.GENSHIN, "100000001", "cn_gf01", 8, "zh-cn", 1)
        val records = listOf(record("1", "301", 3), record("2", "301", 5))
        val snapshot = GachaAnalysis.snapshot(account.game, records)
        val loaded = GachaUiState(busy = true, progress = "读取本地记录…")
            .withLocalSnapshot(listOf(account), account, snapshot)

        assertFalse(loaded.busy)
        assertEquals("", loaded.progress)
        assertEquals(2, loaded.records.size)
        assertEquals(2, loaded.pityByRecordId["2"])
        assertEquals(1, loaded.poolStats.single().count5)
    }

    @Test
    fun `limited pool reports losses and average up cost`() {
        val records = (1..9).map { index ->
            record(
                id = index.toString(),
                type = "301",
                rarity = if (index == 3 || index == 7) 5 else 3,
                name = when (index) {
                    3 -> "七七"
                    7 -> "限定角色"
                    else -> "测试物品"
                },
            )
        }

        val stats = GachaAnalysis.calculate(GameKind.GENSHIN, records).single()

        assertEquals(1, stats.lossCount)
        assertEquals(1, stats.upCount)
        assertEquals(7.0, stats.averageUpPity, 0.001)
        assertTrue(stats.targetPulls.first { it.record.name == "七七" }.isLoss == true)
        assertTrue(stats.targetPulls.first { it.record.name == "限定角色" }.isLoss == false)
    }

    @Test
    fun `miliastra pools use five item pages while normal pools use twenty`() {
        val permanentOde = GameKind.GENSHIN.pool("1000")
        val eventOde = GameKind.GENSHIN.pool("2000")
        assertEquals(5, permanentOde.apiPageSize)
        assertEquals(5, eventOde.apiPageSize)
        assertEquals(20, GameKind.GENSHIN.pool("301").apiPageSize)
        assertEquals(20, GameKind.STAR_RAIL.pool("11").apiPageSize)
        assertFalse(isGachaPageFinished(eventOde, 5, overlap = false, lastId = "99", previousEndId = "0"))
        assertFalse(isGachaPageFinished(eventOde, 5, overlap = true, lastId = "99", previousEndId = "0", historyComplete = false))
        assertTrue(isGachaPageFinished(eventOde, 5, overlap = true, lastId = "99", previousEndId = "0", historyComplete = true))
        assertTrue(isGachaPageFinished(eventOde, 4, overlap = false, lastId = "99", previousEndId = "0"))
        assertTrue(isGachaPageFinished(GameKind.GENSHIN.pool("301"), 20, overlap = true, lastId = "99", previousEndId = "0"))
    }

    @Test
    fun `miliastra permanent pool tracks four star seventy pity`() {
        val records = (1..6).map { index ->
            record(
                id = index.toString(),
                type = "1000",
                rarity = if (index == 4) 4 else 2,
                name = if (index == 4) "套装形录" else "装扮形录",
            )
        }

        val stats = GachaAnalysis.calculate(GameKind.GENSHIN, records).single()

        assertEquals(4, stats.pool.targetRarity)
        assertEquals(70, stats.pool.hardPity)
        assertEquals(1, stats.targetCount)
        assertEquals(0, stats.count5)
        assertEquals(1, stats.count4)
        assertEquals(2, stats.currentPity)
        assertEquals(4.0, stats.averageTargetPity, 0.001)
        assertEquals("4星平均", stats.averageLabel)
    }

    @Test
    fun `selected star rail limited character is counted as loss`() {
        val records = (1..9).map { index ->
            record(
                id = index.toString(),
                type = "11",
                rarity = if (index == 3 || index == 7) 5 else 3,
                game = GameKind.STAR_RAIL,
                uid = "100000002",
                name = when (index) {
                    3 -> "希儿"
                    7 -> "当前UP角色"
                    else -> "测试物品"
                },
            )
        }

        val snapshot = GachaAnalysis.snapshot(GameKind.STAR_RAIL, records, setOf("希儿"))
        val stats = snapshot.poolStats.single()

        assertEquals(1, stats.lossCount)
        assertEquals(1, stats.upCount)
        assertTrue(stats.targetPulls.first { it.record.name == "希儿" }.isLoss == true)
        assertTrue("希儿" in snapshot.customLossCandidates)
        assertTrue("当前UP角色" in snapshot.customLossCandidates)
    }

    @Test
    fun `uigf v4 point 2 round trip keeps miliastra records separate`() {
        val account = GachaAccount(GameKind.GENSHIN, "100000001", "cn_gf01", 8, "zh-cn", 1)
        val beyond = record("100", "20021", 5, name = "女性装扮·测试套装").copy(
            uigfGachaType = "2000",
            gachaId = "20",
            itemType = "装扮套装",
        )

        val text = UigfCodec.encode(listOf(GachaBundle(account, listOf(beyond))), "1.1.0")
        val root = JSONObject(text)

        assertTrue(root.has("hk4e_ugc"))
        assertFalse(root.has("hk4e"))
        val decoded = UigfCodec.decode(text).single().records.single()
        assertEquals("2000", decoded.displayPoolType)
        assertEquals("20021", decoded.gachaType)
        assertEquals("女性装扮·测试套装", decoded.name)
        assertEquals("20", decoded.gachaId)
    }

    @Test
    fun `mihoyo x4 ds signs sorted query and empty get body`() {
        val ds = MihoyoRequestSigner.createDs(
            method = "GET",
            query = linkedMapOf("z" to "last", "stoken" to "v2_test"),
            body = "ignored",
            salt = "test-salt",
            signOnly = false,
            timestamp = 1_700_000_000L,
            random = "123456",
        )

        assertEquals("1700000000,123456,800d50ffae7482a28d7f09e57131caa0", ds)
    }

    @Test
    fun `mihoyo lk2 auth key ds signs only salt time and random`() {
        val ds = MihoyoRequestSigner.createDs(
            method = "POST",
            query = emptyMap(),
            body = "{\"game_biz\":\"hk4e_cn\"}",
            salt = "test-salt",
            signOnly = true,
            timestamp = 1_700_000_000L,
            random = "Ab12Cd",
        )

        assertEquals("1700000000,Ab12Cd,9d361a09ae28f90c52930b346f166b0c", ds)
    }

    private fun record(
        id: String,
        type: String,
        rarity: Int,
        game: GameKind = GameKind.GENSHIN,
        uid: String = "100000001",
        name: String = "测试物品",
    ) = GachaRecord(
        game = game,
        uid = uid,
        id = id,
        gachaType = type,
        uigfGachaType = if (game == GameKind.GENSHIN) game.normalizedPoolType(type) else "",
        gachaId = if (game == GameKind.STAR_RAIL) "gacha" else "",
        itemId = "1",
        name = name,
        itemType = "角色",
        rankType = rarity.toString(),
        count = "1",
        time = "2026-01-01 00:00:${id.takeLast(2).padStart(2, '0')}",
    )
}
