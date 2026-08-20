package com.androidtoolsuite.app.plugins.gacha

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GachaLegacyFixtureTest {
    @Test fun fixturesKeepGamesAndPoolStateSeparate() {
        val genshin = fixture("genshin-records.json")
        val starRail = fixture("starrail-records.json")

        assertEquals(GameKind.GENSHIN.code, genshin.getString("game"))
        assertEquals(GameKind.STAR_RAIL.code, starRail.getString("game"))
        assertTrue(genshin.getJSONArray("poolSyncState").getJSONObject(0).getBoolean("historyComplete"))
        assertFalse(starRail.getJSONArray("poolSyncState").getJSONObject(0).getBoolean("historyComplete"))
        assertEquals("100000001", genshin.getJSONArray("records").getJSONObject(0).getString("uid"))
        assertEquals("100000002", starRail.getJSONArray("records").getJSONObject(0).getString("uid"))
    }

    @Test fun streamedRecordProofIsDeterministic() {
        val keys = (1..20_000).map {
            GachaDatasetIntegrity.recordKey(
                GameKind.GENSHIN.code,
                "100000001",
                it.toString().padStart(19, '0'),
            )
        }
        assertEquals(GachaDatasetIntegrity.digest(keys), GachaDatasetIntegrity.digest(keys.shuffled()))
        assertEquals(keys.size, keys.toSet().size)
    }

    private fun fixture(name: String) = JSONObject(
        checkNotNull(javaClass.getResource("/legacy/$name")).readText(),
    )
}
