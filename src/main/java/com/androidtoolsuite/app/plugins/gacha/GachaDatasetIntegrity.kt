package com.androidtoolsuite.app.plugins.gacha

import java.security.MessageDigest

/** Compact deterministic proof retained while a streamed Bridge Dataset is restored. */
internal data class GachaDatasetIntegrity(
    val gameCode: String,
    val accountUids: Set<String>,
    val recordKeys: Set<String>,
    val poolStates: Map<String, Boolean>,
) {
    val accountCount: Int = accountUids.size
    val recordCount: Int = recordKeys.size
    val recordDigest: String = digest(recordKeys)

    companion object {
        fun recordKey(gameCode: String, uid: String, recordId: String): String =
            "$gameCode\u0000$uid\u0000$recordId"

        fun poolKey(gameCode: String, uid: String, poolType: String): String =
            "$gameCode\u0000$uid\u0000$poolType"

        fun digest(keys: Collection<String>): String {
            val digest = MessageDigest.getInstance("SHA-256")
            keys.sorted().forEach { key ->
                digest.update(key.toByteArray(Charsets.UTF_8))
                digest.update(0)
            }
            return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
        }
    }
}
