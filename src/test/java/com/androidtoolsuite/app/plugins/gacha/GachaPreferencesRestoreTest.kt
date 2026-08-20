package com.androidtoolsuite.app.plugins.gacha

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GachaPreferencesRestoreTest {
    @Test fun validatesTypedReadsInsteadOfGetAllRepresentations() {
        val expected = linkedMapOf<String, Any>(
            "selected-account" to "hk4e:10001",
            "sources" to linkedSetOf("local-rules", "record-field"),
            "enabled" to true,
            "count" to 3,
        )
        assertTrue(restoredPreferencesMatch(fakePreferences(expected, stringifyGetAll = true), expected))
    }

    @Test fun rejectsMissingOrDifferentValues() {
        val expected = linkedMapOf<String, Any>("selected-account" to "hk4e:10001")
        assertFalse(restoredPreferencesMatch(fakePreferences(emptyMap(), true), expected))
        assertFalse(
            restoredPreferencesMatch(
                fakePreferences(mapOf("selected-account" to "hk4e:other"), true),
                expected,
            ),
        )
    }

    private fun fakePreferences(values: Map<String, Any>, stringifyGetAll: Boolean): SharedPreferences =
        Proxy.newProxyInstance(
            SharedPreferences::class.java.classLoader,
            arrayOf(SharedPreferences::class.java),
        ) { _, method, arguments ->
            val key = arguments?.firstOrNull() as? String
            when (method.name) {
                "getAll" -> if (stringifyGetAll) values.mapValues { it.value.toString() } else values
                "getString" -> values[key] as? String ?: arguments?.get(1)
                "getStringSet" -> {
                    @Suppress("UNCHECKED_CAST")
                    (values[key] as? Set<String>) ?: arguments?.get(1)
                }
                "getBoolean" -> values[key] as? Boolean ?: arguments?.get(1)
                "getInt" -> values[key] as? Int ?: arguments?.get(1)
                "getLong" -> values[key] as? Long ?: arguments?.get(1)
                "getFloat" -> values[key] as? Float ?: arguments?.get(1)
                "contains" -> values.containsKey(key)
                else -> error("Unexpected SharedPreferences call: ${method.name}")
            }
        } as SharedPreferences
}
