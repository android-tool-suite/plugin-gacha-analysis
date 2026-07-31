package com.androidtoolsuite.app.plugins.gacha

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale

internal data class GachaLink(
    val game: GameKind,
    val parameters: LinkedHashMap<String, String>,
    val overseas: Boolean,
    val uidHint: String = "",
) {
    val gameBiz: String get() = parameters["game_biz"].orEmpty()
    val region: String get() = parameters["region"].orEmpty()
    val lang: String get() = parameters["lang"].orEmpty().ifBlank { "zh-cn" }

    fun requestUrl(poolType: String): String {
        val base = if (overseas) game.overseasApiBase else game.cnApiBase
        val query = LinkedHashMap(parameters).apply {
            remove("gacha_type")
            remove("page")
            remove("size")
            remove("end_id")
        }
        return base + game.apiPathFor(poolType) + "?" + query.toQueryString()
    }

    fun copyableUrl(): String = requestUrl(game.pools.first().type)

    fun summary(): String {
        return "${game.label} · ${if (overseas) "国际服" else "国服"} · AuthKey 已就绪"
    }
}

internal object GachaLinkParser {
    private val urlPattern = Regex("https?://[^\\s\\\"'<>]+", RegexOption.IGNORE_CASE)

    fun parse(input: String): GachaLink {
        val cleaned = input.trim()
            .replace("\\u0026", "&", ignoreCase = true)
            .replace("\\/", "/")
            .replace("&amp;", "&")
        val rawUrl = urlPattern.find(cleaned)?.value?.trimEnd(')', ']', '}', ',', ';')
            ?: throw IllegalArgumentException("没有找到完整的 https 抽卡链接")
        val query = rawUrl.substringAfter('?', "")
        require(query.isNotBlank()) { "链接缺少查询参数" }
        val parameters = LinkedHashMap<String, String>()
        query.split('&').forEach { part ->
            if (part.isBlank()) return@forEach
            val key = decode(part.substringBefore('='))
            val value = decode(part.substringAfter('=', ""))
            if (key.isNotBlank()) parameters[key] = value
        }
        require(parameters["authkey"].orEmpty().isNotBlank()) { "链接缺少 AuthKey" }
        val lower = rawUrl.lowercase(Locale.ROOT)
        val gameBiz = parameters["game_biz"].orEmpty()
        val game = GameKind.fromBiz(gameBiz) ?: when {
            "hkrpg" in lower || "starrail" in lower -> GameKind.STAR_RAIL
            "hk4e" in lower || "genshin" in lower -> GameKind.GENSHIN
            else -> null
        } ?: throw IllegalArgumentException("无法判断链接属于原神还是星穹铁道")
        if (gameBiz.isBlank()) {
            parameters["game_biz"] = game.bizPrefix + if ("hoyoverse" in lower || "-sg." in lower) "global" else "cn"
        }
        parameters.putIfAbsent("authkey_ver", "1")
        parameters.putIfAbsent("sign_type", "2")
        parameters.putIfAbsent("auth_appid", "webview_gacha")
        parameters.putIfAbsent("lang", "zh-cn")
        val overseas = "hoyoverse" in lower || "-sg." in lower || parameters["game_biz"].orEmpty().endsWith("global")
        return GachaLink(game, parameters, overseas)
    }

    private fun decode(value: String): String = try {
        URLDecoder.decode(value, "UTF-8")
    } catch (_: IllegalArgumentException) {
        value
    }
}

private class GachaResponseException(message: String) : IOException(message)

internal fun isGachaPageFinished(
    pool: GachaPool,
    listSize: Int,
    overlap: Boolean,
    lastId: String,
    previousEndId: String,
    historyComplete: Boolean = false,
): Boolean {
    // 没有完整标记时继续扫描千星奇域，自动补齐旧版本只保存第一页的数据；
    // 一旦确认到达过历史末页，后续同步即可和普通池一样在本地重复处停止。
    val overlapIsTerminal = overlap && (!pool.isBeyond || historyComplete)
    return overlapIsTerminal || listSize < pool.apiPageSize || lastId.isBlank() || lastId == previousEndId
}

internal class GachaApiClient(private val store: GachaStore) {
    fun fetch(link: GachaLink, onProgress: (String) -> Unit): GachaBundle {
        val records = mutableListOf<GachaRecord>()
        var accountUid = link.uidHint
        var timezone = inferTimezone(link.region)
        var responseRegion = link.region
        val completedPoolTypes = LinkedHashSet<String>()

        link.game.pools.forEachIndexed { poolIndex, pool ->
            val pageSize = pool.apiPageSize
            var page = 1
            var endId = "0"
            var existingIds: Set<String> = if (accountUid.isBlank()) {
                emptySet()
            } else {
                store.recordIds(link.game, accountUid, pool.type)
            }
            var historyComplete = pool.isBeyond && accountUid.isNotBlank() &&
                store.isHistoryComplete(link.game, accountUid, pool.type)
            var reachedHistoryEnd = false
            var finished = false
            while (!finished) {
                onProgress("${link.game.label} · ${pool.label} · 第 $page 页（${poolIndex + 1}/${link.game.pools.size}）")
                val params = LinkedHashMap(link.parameters).apply {
                    put("gacha_type", pool.type)
                    put("page", page.toString())
                    put("size", pageSize.toString())
                    put("end_id", endId)
                }
                val root = requestJson(link.requestUrl(pool.type).substringBefore('?') + "?" + params.toQueryString())
                val data = root.optJSONObject("data") ?: JSONObject()
                timezone = data.optString("region_time_zone").toIntOrNull() ?: timezone
                responseRegion = data.optString("region", responseRegion).ifBlank { responseRegion }
                val list = data.optJSONArray("list")
                if (list == null || list.length() == 0) {
                    reachedHistoryEnd = true
                    break
                }
                var overlap = false
                var lastId = ""
                for (index in 0 until list.length()) {
                    val item = list.optJSONObject(index) ?: continue
                    val uid = item.optString("uid")
                    if (uid.isNotBlank()) {
                        if (accountUid.isBlank()) {
                            accountUid = uid
                            existingIds = store.recordIds(link.game, accountUid, pool.type)
                            historyComplete = pool.isBeyond && store.isHistoryComplete(link.game, accountUid, pool.type)
                        } else if (uid != accountUid) {
                            throw IOException("接口返回了不一致的 UID")
                        }
                    }
                    val id = item.optString("id")
                    if (id.isBlank()) continue
                    lastId = id
                    if (id in existingIds) {
                        overlap = true
                        if (!pool.isBeyond || historyComplete) break
                        continue
                    }
                    val rawType = if (pool.isBeyond) {
                        item.optString("op_gacha_type", pool.type)
                    } else {
                        item.optString("gacha_type", pool.type)
                    }
                    // Observed API fields: normal Genshin returns gacha_id/time (not is_up),
                    // Star Rail returns gacha_id/time and may return is_up, while Miliastra
                    // (getBeyondGachaLog) returns schedule_id/time/is_up and op_gacha_type.
                    records += GachaRecord(
                        game = link.game,
                        uid = uid.ifBlank { accountUid },
                        id = id,
                        gachaType = rawType,
                        uigfGachaType = if (link.game == GameKind.GENSHIN) link.game.normalizedPoolType(rawType) else "",
                        gachaId = item.optString("gacha_id"),
                        scheduleId = item.optString("schedule_id"),
                        itemId = item.optString("item_id"),
                        name = if (pool.isBeyond) item.optString("item_name") else item.optString("name"),
                        itemType = item.optString("item_type"),
                        rankType = item.optString("rank_type"),
                        count = item.optString("count", "1"),
                        time = item.optString("time"),
                        isUp = item.optString("is_up"),
                    )
                }
                if (list.length() < pageSize && lastId.isNotBlank()) reachedHistoryEnd = true
                finished = isGachaPageFinished(pool, list.length(), overlap, lastId, endId, historyComplete)
                endId = lastId
                page += 1
                if (!finished) Thread.sleep(REQUEST_INTERVAL_MS)
            }
            if (pool.isBeyond && (historyComplete || reachedHistoryEnd)) completedPoolTypes += pool.type
            if (poolIndex < link.game.pools.lastIndex) Thread.sleep(REQUEST_INTERVAL_MS)
        }
        require(accountUid.isNotBlank()) { "没有获取到任何记录；请确认账号至少有一条可查询记录" }
        val account = GachaAccount(
            game = link.game,
            uid = accountUid,
            region = responseRegion,
            timezone = timezone,
            lang = link.lang,
            lastSyncAt = System.currentTimeMillis(),
        )
        return GachaBundle(
            account,
            records.map { if (it.uid.isBlank()) it.copy(uid = accountUid) else it },
            completedPoolTypes,
        )
    }

    private fun requestJson(url: String): JSONObject {
        var lastError: Throwable? = null
        repeat(3) { attempt ->
            try {
                val root = JSONObject(Http.get(url, emptyMap()))
                val retcode = root.optInt("retcode", 0)
                if (retcode == 0) return root
                val message = root.optString("message", "接口错误")
                if (retcode == -110 && attempt < 2) {
                    Thread.sleep(1_500L * (attempt + 1))
                } else {
                    throw GachaResponseException("获取失败（$retcode）：$message")
                }
            } catch (error: Throwable) {
                if (error is GachaResponseException) throw error
                lastError = error
                if (attempt < 2 && error !is IllegalArgumentException) Thread.sleep(1_500L * (attempt + 1))
            }
        }
        throw IOException(lastError?.message ?: "网络请求失败", lastError)
    }

    private fun inferTimezone(region: String): Int = when {
        region.startsWith("cn_") -> 8
        region == "os_usa" -> -5
        region == "os_euro" -> 1
        region == "os_asia" || region == "os_cht" -> 8
        else -> 8
    }

    companion object {
        private const val REQUEST_INTERVAL_MS = 350L
    }
}

internal class MihoyoAccountClient {
    data class QrSession(val ticket: String, val url: String, val deviceId: String)
    data class QrStatus(val status: String, val cookie: String? = null)

    private val deviceId = randomHex(32).lowercase(Locale.ROOT)
    private val deviceFp = randomHex(13).lowercase(Locale.ROOT)

    fun createQrSession(): QrSession {
        val root = Http.json(QR_CREATE_API, qrHeaders(deviceId), "POST")
        checkResponse(root, "创建米游社登录二维码")
        val data = root.optJSONObject("data") ?: throw IOException("米游社未返回二维码")
        val ticket = data.optString("ticket")
        val url = data.optString("url")
        require(ticket.isNotBlank() && url.isNotBlank()) { "米游社未返回完整二维码" }
        return QrSession(ticket, url, deviceId)
    }

    fun queryQrSession(session: QrSession): QrStatus {
        val body = JSONObject().put("ticket", session.ticket).toString()
        val root = Http.json(
            QR_STATUS_API,
            qrHeaders(session.deviceId) + ("Content-Type" to "application/json; charset=UTF-8"),
            "POST",
            body,
        )
        checkResponse(root, "查询米游社扫码状态")
        val data = root.optJSONObject("data") ?: throw IOException("米游社未返回扫码状态")
        val status = data.optString("status")
        if (status != "Confirmed") return QrStatus(status)
        val userInfo = data.optJSONObject("user_info") ?: throw IOException("米游社未返回账号信息")
        val accountId = userInfo.optString("aid")
        val mid = userInfo.optString("mid")
        val tokens = data.optJSONArray("tokens")
        val stoken = (0 until (tokens?.length() ?: 0))
            .mapNotNull { tokens?.optJSONObject(it) }
            .firstOrNull { it.optString("token").isNotBlank() }
            ?.optString("token")
            ?: throw IOException("米游社扫码登录未返回 SToken")
        require(accountId.isNotBlank()) { "米游社扫码登录未返回账号 ID" }
        val cookie = linkedMapOf(
            "stoken" to stoken,
            "stuid" to accountId,
            "account_id" to accountId,
            "account_id_v2" to accountId,
            "mid" to mid,
            "account_mid_v2" to mid,
        ).filterValues(String::isNotBlank).entries.joinToString("; ") { "${it.key}=${it.value}" }
        return QrStatus(status, cookie)
    }

    fun roles(rawCookie: String): Pair<String, List<MihoyoRole>> {
        val cookies = parseCookie(rawCookie)
        var accountId = cookies["account_id"]
            ?: cookies["account_id_v2"]
            ?: cookies["stuid"]
            ?: cookies["login_uid"]
            ?: cookies["ltuid_v2"]
            ?: throw IllegalArgumentException("登录信息缺少账号 ID，请重新登录后再试")
        if (cookies["stoken"].isNullOrBlank() && cookies["stoken_v2"].isNullOrBlank()) {
            val ticket = cookies["login_ticket"] ?: throw IllegalArgumentException(
                "当前 Cookie 只有网页登录令牌，无法生成抽卡链接；请使用上方米游社扫码登录，或粘贴包含 SToken 的 Cookie",
            )
            val params = linkedMapOf("login_ticket" to ticket, "token_types" to "3", "uid" to accountId)
            val root = Http.json(TOKEN_API + "?" + params.toQueryString(), requestHeaders(emptyMap(), query = params))
            checkResponse(root, "换取 SToken")
            val list = root.optJSONObject("data")?.optJSONArray("list")
            val token = (0 until (list?.length() ?: 0))
                .mapNotNull { list?.optJSONObject(it) }
                .firstOrNull { it.optString("name").equals("stoken", true) }
                ?.optString("token")
                ?: list?.optJSONObject(0)?.optString("token")
                ?: throw IOException("米游社未返回 SToken")
            cookies["stoken"] = token
        }

        val stoken = cookies["stoken"] ?: cookies["stoken_v2"]
            ?: throw IllegalArgumentException("米游社登录信息缺少 SToken，请重新扫码登录")
        val mid = cookies["mid"] ?: cookies["account_mid_v2"] ?: cookies["ltmid_v2"]
            ?: throw IllegalArgumentException("米游社登录信息缺少 mid，请重新扫码登录")

        var cookieTokenRefreshed = false
        fun refreshCookieToken() {
            val params = linkedMapOf("stoken" to stoken)
            val exchangeCookie = linkedMapOf("stoken" to stoken, "mid" to mid)
            val tokenRoot = Http.json(
                COOKIE_TOKEN_API + "?" + params.toQueryString(),
                requestHeaders(exchangeCookie, query = params),
            )
            checkResponse(tokenRoot, "换取 CookieToken")
            val tokenData = tokenRoot.optJSONObject("data") ?: throw IOException("米游社未返回 CookieToken")
            val cookieToken = tokenData.optString("cookie_token")
            require(cookieToken.isNotBlank()) { "米游社未返回 CookieToken" }
            accountId = tokenData.optString("uid").ifBlank { accountId }
            cookies["cookie_token"] = cookieToken
            cookieTokenRefreshed = true
        }
        if (cookies["cookie_token"].isNullOrBlank()) refreshCookieToken()

        cookies["account_id"] = accountId
        cookies.putIfAbsent("stuid", accountId)
        cookies.putIfAbsent("mid", mid)
        fun requestRoles(): JSONObject {
            val roleCookie = linkedMapOf(
                "account_id" to accountId,
                "cookie_token" to cookies.getValue("cookie_token"),
            )
            return Http.json(ROLE_API, requestHeaders(roleCookie))
        }
        var rolesRoot = requestRoles()
        if (rolesRoot.optInt("retcode", Int.MIN_VALUE) != 0 && !cookieTokenRefreshed) {
            // 已保存的 CookieToken 可能先于 SToken 失效；刷新后重试一次即可保持登录。
            refreshCookieToken()
            cookies["account_id"] = accountId
            rolesRoot = requestRoles()
        }
        checkResponse(rolesRoot, "读取游戏角色")
        val list = rolesRoot.optJSONObject("data")?.optJSONArray("list")
        val roles = (0 until (list?.length() ?: 0)).mapNotNull { index ->
            val item = list?.optJSONObject(index) ?: return@mapNotNull null
            val gameBiz = item.optString("game_biz")
            val game = GameKind.fromBiz(gameBiz) ?: return@mapNotNull null
            MihoyoRole(
                game = game,
                uid = item.optString("game_uid"),
                region = item.optString("region"),
                regionName = item.optString("region_name"),
                level = item.optInt("level"),
                nickname = item.optString("nickname"),
                gameBiz = gameBiz,
            )
        }
        require(roles.isNotEmpty()) { "该米游社账号没有绑定原神或星穹铁道角色" }
        return cookies.entries.joinToString("; ") { "${it.key}=${it.value}" } to roles
    }

    fun generateLink(cookie: String, role: MihoyoRole): GachaLink {
        require(role.supportsMihoyoGachaLink()) { MIHOYO_STAR_RAIL_UNSUPPORTED }
        val cookies = parseCookie(cookie)
        val stoken = cookies["stoken"] ?: cookies["stoken_v2"]
            ?: throw IllegalArgumentException("米游社登录信息缺少 SToken，请重新扫码登录")
        val mid = cookies["mid"] ?: cookies["account_mid_v2"] ?: cookies["ltmid_v2"]
            ?: throw IllegalArgumentException("米游社登录信息缺少 mid，请重新扫码登录")
        val body = JSONObject()
            .put("game_biz", role.gameBiz)
            .put("game_uid", role.uid)
            .put("region", role.region)
            .put("auth_appid", "webview_gacha")
            .toString()
        val authCookie = linkedMapOf("stoken" to stoken, "mid" to mid)
        val headers = requestHeaders(
            authCookie,
            method = "POST",
            body = body,
            salt = LK2_SALT,
            signOnly = true,
        ) + ("Content-Type" to "application/json; charset=UTF-8")
        val root = Http.json(MIHOYO_AUTHKEY_API, headers, "POST", body)
        checkResponse(root, "生成抽卡链接")
        val data = root.optJSONObject("data") ?: throw IOException("米游社未返回 AuthKey")
        val authkey = data.optString("authkey")
        require(authkey.isNotBlank()) { "米游社未返回 AuthKey" }
        return buildMihoyoGachaLink(
            role = role,
            authkey = authkey,
            authkeyVersion = data.optString("authkey_ver", "1"),
            signType = data.optString("sign_type", "2"),
        )
    }

    private fun requestHeaders(
        cookies: Map<String, String>,
        method: String = "GET",
        query: Map<String, String> = emptyMap(),
        body: String = "",
        salt: String = X4_SALT,
        signOnly: Boolean = false,
    ): Map<String, String> = linkedMapOf(
        "Cookie" to cookies.toCookieString(),
        "DS" to MihoyoRequestSigner.createDs(method, query, body, salt, signOnly),
        "Referer" to "https://webstatic.mihoyo.com",
        "User-Agent" to "Mozilla/5.0 (Windows NT 10.0; Win64; x64) miHoYoBBS/$APP_VERSION",
        "x-rpc-app_version" to APP_VERSION,
        "x-rpc-client_type" to "5",
        "x-requested-with" to "com.mihoyo.hyperion",
        "x-rpc-device_id" to deviceId,
        "x-rpc-device_fp" to deviceFp,
    )

    private fun qrHeaders(deviceId: String): Map<String, String> = linkedMapOf(
        "User-Agent" to "HYPContainer/1.3.3.182",
        "x-rpc-device_id" to deviceId,
        "x-rpc-app_id" to "ddxf5dufpuyo",
        "x-rpc-client_type" to "3",
    )

    private fun checkResponse(root: JSONObject, action: String) {
        val code = root.optInt("retcode", Int.MIN_VALUE)
        if (code != 0) throw IOException("$action 失败（$code）：${root.optString("message", "未知错误")}")
    }

    private fun parseCookie(raw: String): LinkedHashMap<String, String> {
        val result = LinkedHashMap<String, String>()
        raw.replace('\n', ';').split(';').forEach { entry ->
            val key = entry.substringBefore('=', "").trim()
            val value = entry.substringAfter('=', "").trim()
            if (key.isNotBlank() && value.isNotBlank()) result[key] = value
        }
        require(result.isNotEmpty()) { "没有读取到米游社登录信息" }
        return result
    }

    private fun randomHex(length: Int): String = buildString {
        repeat(length) { append("0123456789ABCDEF"[SECURE_RANDOM.nextInt(16)]) }
    }

    companion object {
        private const val APP_VERSION = "2.109.0"
        private const val X4_SALT = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs"
        private const val LK2_SALT = "d9200c846b10886e8c874fc33c8f308b"
        private const val TOKEN_API = "https://api-takumi.mihoyo.com/auth/api/getMultiTokenByLoginTicket"
        private const val COOKIE_TOKEN_API = "https://passport-api.mihoyo.com/account/auth/api/getCookieAccountInfoBySToken"
        private const val QR_CREATE_API = "https://passport-api.mihoyo.com/account/ma-cn-passport/app/createQRLogin"
        private const val QR_STATUS_API = "https://passport-api.mihoyo.com/account/ma-cn-passport/app/queryQRLoginStatus"
        private const val ROLE_API = "https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie"
        private val SECURE_RANDOM = SecureRandom()
    }
}

internal fun buildMihoyoGachaLink(
    role: MihoyoRole,
    authkey: String,
    authkeyVersion: String = "1",
    signType: String = "2",
    timestampSeconds: Long = System.currentTimeMillis() / 1_000L,
): GachaLink {
    require(role.supportsMihoyoGachaLink()) { MIHOYO_STAR_RAIL_UNSUPPORTED }
    val params = linkedMapOf(
        "authkey_ver" to authkeyVersion,
        "sign_type" to signType,
        "auth_appid" to "webview_gacha",
        "win_mode" to "fullscreen",
        "timestamp" to timestampSeconds.toString(),
        "region" to role.region,
        "default_gacha_type" to "301",
        "lang" to "zh-cn",
        "authkey" to authkey,
        "game_biz" to role.gameBiz,
        "os_system" to "Android",
        "device_model" to "Android Tool Suite",
        "plat_type" to "android",
    )
    return GachaLink(
        game = role.game,
        parameters = LinkedHashMap(params),
        overseas = false,
        uidHint = role.uid,
    )
}

internal const val MIHOYO_AUTHKEY_API = "https://api-takumi.miyoushe.com/binding/api/genAuthKey"

internal object MihoyoRequestSigner {
    fun createDs(
        method: String,
        query: Map<String, String>,
        body: String,
        salt: String,
        signOnly: Boolean,
        timestamp: Long = System.currentTimeMillis() / 1000L,
        random: String = if (signOnly) randomAlphaNumeric(6) else (100_000 + SECURE_RANDOM.nextInt(100_001)).toString(),
    ): String {
        val source = if (signOnly) {
            "salt=$salt&t=$timestamp&r=$random"
        } else {
            val queryText = query.entries.sortedBy { it.key }
                .joinToString("&") { (key, value) -> "$key=$value" }
            val bodyText = if (method.equals("GET", true)) "" else body
            "salt=$salt&t=$timestamp&r=$random&b=$bodyText&q=$queryText"
        }
        return "$timestamp,$random,${md5(source)}"
    }

    private fun randomAlphaNumeric(length: Int): String = buildString {
        repeat(length) { append(ALPHABET[SECURE_RANDOM.nextInt(ALPHABET.length)]) }
    }

    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    private val SECURE_RANDOM = SecureRandom()
}

internal object Http {
    fun get(url: String, headers: Map<String, String>): String = request(url, headers, "GET", null)

    fun json(url: String, headers: Map<String, String>, method: String = "GET", body: String? = null): JSONObject =
        JSONObject(request(url, headers, method, body))

    private fun request(url: String, headers: Map<String, String>, method: String, body: String?): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json, */*")
            setRequestProperty("User-Agent", "Android-Tool-Suite/Gacha-Analysis")
            headers.forEach { (key, value) -> if (value.isNotBlank()) setRequestProperty(key, value) }
            if (body != null) {
                doOutput = true
                val bytes = body.toByteArray(Charsets.UTF_8)
                setFixedLengthStreamingMode(bytes.size)
                outputStream.use { it.write(bytes) }
            }
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.use { input ->
                val output = ByteArrayOutputStream()
                input.copyTo(output)
                output.toString("UTF-8")
            }.orEmpty()
            if (code !in 200..299) {
                throw IOException("HTTP $code（${connection.url.host}${connection.url.path}）")
            }
            return text
        } finally {
            connection.disconnect()
        }
    }
}

private fun Map<String, String>.toQueryString(): String = entries.joinToString("&") { (key, value) ->
    encode(key) + "=" + encode(value)
}

private fun Map<String, String>.toCookieString(): String = entries
    .filter { (key, value) -> key.isNotBlank() && value.isNotBlank() }
    .sortedBy { it.key }
    .joinToString(";", postfix = ";") { (key, value) -> "$key=$value" }

private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

private fun md5(value: String): String = MessageDigest.getInstance("MD5")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }
