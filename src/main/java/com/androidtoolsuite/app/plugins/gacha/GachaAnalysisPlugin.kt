package com.androidtoolsuite.app.plugins.gacha

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.View
import android.webkit.CookieManager
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import com.androidtoolsuite.app.plugin.api.PluginHost
import com.androidtoolsuite.app.plugin.api.ToolPlugin
import com.androidtoolsuite.app.plugin.gacha.BuildConfig
import com.androidtoolsuite.app.plugin.model.ImportedPluginDescriptor
import com.androidtoolsuite.app.ui.composePluginView
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class GachaAnalysisPlugin(
    private val descriptor: ImportedPluginDescriptor = GachaAnalysisPluginDescriptor.create(),
) : ToolPlugin {
    internal val state: MutableState<GachaUiState> = mutableStateOf(GachaUiState())

    private val executor = Executors.newFixedThreadPool(3)
    private val accountClient = MihoyoAccountClient()
    private var activity: Activity? = null
    private var host: PluginHost? = null
    private var rootView: View? = null
    private var store: GachaStore? = null
    private var apiClient: GachaApiClient? = null
    private var mihoyoSessionStore: MihoyoSessionStore? = null
    private var currentLink: GachaLink? = null
    private var pendingMihoyoCookie: String? = null
    @Volatile private var pendingMihoyoQr: MihoyoAccountClient.QrSession? = null
    private var captureStartedAt: String? = null
    private val snapshotCache = object : LinkedHashMap<String, LocalAccountSnapshot>(3, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, LocalAccountSnapshot>?): Boolean = size > 2
    }

    override fun id(): String = descriptor.id
    override fun title(): String = descriptor.title
    override fun description(): String = descriptor.description
    override fun version(): String = descriptor.version
    override fun removable(): Boolean = true
    override fun dependencies(): Set<String> = descriptor.dependencies

    override fun createView(activity: Activity, host: PluginHost): View {
        if (this.activity !== activity || rootView == null) {
            this.activity = activity
            this.host = host
            store = GachaStore(activity)
            apiClient = GachaApiClient(requireStore())
            mihoyoSessionStore = MihoyoSessionStore(activity)
            rootView = composePluginView(activity) { GachaAnalysisScreen(this) }
            initialize()
        }
        return rootView!!
    }

    internal fun selectedAccount(): GachaAccount? = state.value.accounts.firstOrNull { it.key == state.value.selectedAccountKey }

    internal fun selectPage(page: GachaPage) = updateState { copy(page = page) }

    internal fun selectAccount(key: String) {
        if (!state.value.busy && state.value.selectedAccountKey == key) return
        runTask("读取本地记录…") {
            val accounts = requireStore().accounts()
            val account = requireNotNull(accounts.firstOrNull { it.key == key }) { "本地账号不存在或已被删除" }
            val snapshot = loadLocalSnapshot(account)
            preferences().edit().putString(PREF_SELECTED_ACCOUNT, key).apply()
            postState { withLocalSnapshot(accounts, account, snapshot) }
        }
    }

    internal fun selectPool(poolType: String) = updateState { copy(selectedPoolType = poolType) }

    internal fun selectRarity(rarity: Int) = updateState { copy(selectedRarity = rarity) }

    internal fun setCustomLossName(name: String, selected: Boolean) {
        val account = selectedAccount()?.takeIf { it.game == GameKind.STAR_RAIL } ?: return
        val updated = state.value.customLossNames.toMutableSet().apply {
            if (selected) add(name) else remove(name)
        }.toSet()
        preferences().edit().putStringSet(customLossPreferenceKey(account), HashSet(updated)).apply()
        synchronized(snapshotCache) { snapshotCache.remove(account.key) }
        runTask("正在按新的歪卡规则重新分析…") {
            val accounts = requireStore().accounts()
            val current = accounts.firstOrNull { it.key == account.key } ?: account
            val snapshot = loadLocalSnapshot(current)
            postState {
                withLocalSnapshot(accounts, current, snapshot).copy(
                    message = if (selected) "已将${name}计为可歪角色。" else "已取消${name}的可歪角色标记。",
                )
            }
        }
    }

    internal fun dismissNotice() = updateState { copy(message = null, error = null) }

    internal fun setManualLink(raw: String) {
        try {
            setLink(GachaLinkParser.parse(raw), "已读取手动粘贴的链接")
        } catch (error: Throwable) {
            updateState { copy(error = error.message ?: "链接格式错误", message = null) }
        }
    }

    internal fun copyLink() {
        val link = currentLink ?: return
        val manager = activity?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        val clip = ClipData.newPlainText("抽卡分析链接", link.copyableUrl())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            clip.description.extras = android.os.PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        manager.setPrimaryClip(clip)
        updateState { copy(message = "链接已复制。它包含临时 AuthKey，请勿发送给不可信的人或服务。", error = null) }
    }

    internal fun clipboardText(): String = try {
        val manager = activity?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        manager?.primaryClip?.getItemAt(0)?.coerceToText(activity)?.toString().orEmpty()
    } catch (_: Throwable) {
        ""
    }

    internal fun syncRecords() {
        val link = currentLink ?: run {
            updateState { copy(error = "请先获取或粘贴抽卡链接") }
            return
        }
        runTask("准备获取记录…") {
            val bundle = requireApiClient().fetch(link) { progress -> postState { copy(progress = progress) } }
            val result = requireStore().merge(bundle)
            refreshFromStore(bundle.account.key)
            postState {
                copy(
                    busy = false,
                    progress = "",
                    message = "同步完成：新增 ${result.inserted} 条，已有 ${result.skipped} 条。",
                    error = null,
                    page = GachaPage.OVERVIEW,
                )
            }
        }
    }

    internal fun beginShizukuCapture() {
        val currentHost = host ?: return
        when {
            !currentHost.isShizukuReady -> updateState { copy(error = "请先启动 Shizuku") }
            !currentHost.hasShizukuPermission() -> {
                currentHost.requestShizukuPermission()
                updateState { copy(message = "请完成 Shizuku 授权，然后再次点击开始捕获。", error = null) }
            }
            !currentHost.isShellServiceConnected -> {
                currentHost.ensureShellService()
                updateState { copy(message = "正在连接 Shizuku UserService，请稍候再试。", error = null) }
            }
            else -> runTask("正在建立日志时间点…") {
                val timestamp = currentHost.runShellCommand("date", "+%m-%d %H:%M:%S.000").trim()
                require(LOGCAT_TIME.matches(timestamp)) { "无法读取设备时间" }
                captureStartedAt = timestamp
                postState {
                    copy(
                        busy = false,
                        progress = "",
                        shizukuCapturing = true,
                        message = "捕获已开始。现在切换到游戏，打开祈愿/跃迁历史记录，再返回点击停止捕获。",
                        error = null,
                    )
                }
            }
        }
    }

    internal fun finishShizukuCapture() {
        val currentHost = host ?: return
        val timestamp = captureStartedAt ?: run {
            updateState { copy(error = "请先开始捕获") }
            return
        }
        runTask("正在筛选游戏日志…") {
            val command = "logcat -d -v raw -T '$timestamp' | grep -E 'auth_appid=webview_gacha|authkey=' | tail -n 400"
            val output = currentHost.runShellCommand("sh", "-c", command)
            val link = extractLatestLink(output) ?: throw IOException("日志中没有找到抽卡链接；请确认历史记录页面已完整打开")
            captureStartedAt = null
            postState { copy(shizukuCapturing = false) }
            postLink(link, "已从 Shizuku 日志捕获链接")
        }
    }

    internal fun openCloud(game: GameKind) = updateState {
        copy(
            browserMode = if (game == GameKind.GENSHIN) BrowserMode.CLOUD_GENSHIN else BrowserMode.CLOUD_STAR_RAIL,
            error = null,
        )
    }

    internal fun openMihoyoLogin() {
        pendingMihoyoQr = null
        runTask("正在创建米游社登录二维码…") {
            val session = accountClient.createQrSession()
            pendingMihoyoQr = session
            postState {
                copy(
                    busy = false,
                    progress = "",
                    mihoyoQrUrl = session.url,
                    mihoyoQrStatus = "等待米游社扫码确认",
                    error = null,
                )
            }
            repeat(120) {
                if (pendingMihoyoQr !== session) return@runTask
                val result = accountClient.queryQrSession(session)
                when (result.status) {
                    "Created" -> postState { copy(mihoyoQrStatus = "等待米游社扫码确认") }
                    "Scanned" -> postState { copy(mihoyoQrStatus = "已扫码，请在米游社中确认登录") }
                    "Confirmed" -> {
                        val cookie = requireNotNull(result.cookie) { "米游社扫码登录未返回凭据" }
                        val (completeCookie, roles) = accountClient.roles(cookie)
                        val supportedRoles = roles.filter { it.supportsMihoyoGachaLink() }
                        if (pendingMihoyoQr !== session) return@runTask
                        pendingMihoyoQr = null
                        requireMihoyoSessionStore().save(completeCookie)
                        pendingMihoyoCookie = completeCookie.takeIf { supportedRoles.isNotEmpty() }
                        postState {
                            copy(
                                busy = false,
                                progress = "",
                                mihoyoQrUrl = null,
                                mihoyoQrStatus = "",
                                mihoyoRoles = supportedRoles,
                                mihoyoSessionSaved = true,
                                message = if (supportedRoles.isNotEmpty()) {
                                    "登录成功，登录状态已在本机加密保存。请选择原神国服角色。"
                                } else {
                                    "登录状态已保存，但未找到原神角色。$MIHOYO_STAR_RAIL_UNSUPPORTED。"
                                },
                                error = null,
                            )
                        }
                        return@runTask
                    }
                }
                Thread.sleep(1_000)
            }
            if (pendingMihoyoQr === session) {
                pendingMihoyoQr = null
                throw IOException("米游社登录二维码已过期，请重新扫码")
            }
        }
    }

    internal fun closeMihoyoQr() {
        pendingMihoyoQr = null
        updateState { copy(mihoyoQrUrl = null, mihoyoQrStatus = "", busy = false, progress = "") }
    }

    internal fun openMihoyoQrExternally() {
        val url = state.value.mihoyoQrUrl ?: return
        try {
            activity?.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (error: Throwable) {
            updateState { copy(error = "无法打开扫码页：${error.message ?: "未安装可处理该链接的应用"}") }
        }
    }

    internal fun closeBrowser() {
        updateState { copy(browserMode = null) }
    }

    internal fun browserCapturedLink(raw: String) {
        try {
            val link = GachaLinkParser.parse(raw)
            updateState { copy(browserMode = null) }
            setLink(link, "已从官方云游戏捕获链接")
        } catch (_: Throwable) {
            // WebView 会经过许多相似请求，只在解析出完整 AuthKey 后结束。
        }
    }

    internal fun useMihoyoCookies(rawCookie: String) {
        runTask("正在读取米游社角色…") {
            val result = accountClient.roles(rawCookie)
            val (cookie, roles) = result
            val supportedRoles = roles.filter { it.supportsMihoyoGachaLink() }
            requireMihoyoSessionStore().save(cookie)
            pendingMihoyoCookie = cookie.takeIf { supportedRoles.isNotEmpty() }
            postState {
                copy(
                    busy = false,
                    progress = "",
                    mihoyoRoles = supportedRoles,
                    mihoyoSessionSaved = true,
                    message = if (supportedRoles.isNotEmpty()) {
                        "登录状态已在本机加密保存，请选择原神国服角色。"
                    } else {
                        "登录状态已保存，但未找到原神角色。$MIHOYO_STAR_RAIL_UNSUPPORTED。"
                    },
                    error = null,
                )
            }
        }
    }

    internal fun useSavedMihoyoLogin() {
        val savedCookie = requireMihoyoSessionStore().load() ?: run {
            updateState {
                copy(
                    mihoyoSessionSaved = false,
                    error = "没有可用的米游社登录状态，请重新扫码登录",
                    message = null,
                )
            }
            return
        }
        runTask("正在刷新已登录的米游社角色…") {
            val (completeCookie, roles) = accountClient.roles(savedCookie)
            val supportedRoles = roles.filter { it.supportsMihoyoGachaLink() }
            requireMihoyoSessionStore().save(completeCookie)
            pendingMihoyoCookie = completeCookie.takeIf { supportedRoles.isNotEmpty() }
            postState {
                copy(
                    busy = false,
                    progress = "",
                    mihoyoRoles = supportedRoles,
                    mihoyoSessionSaved = true,
                    message = if (supportedRoles.isNotEmpty()) {
                        "已恢复米游社登录，请选择要生成链接的原神国服角色。"
                    } else {
                        "已恢复米游社登录，但未找到原神角色。$MIHOYO_STAR_RAIL_UNSUPPORTED。"
                    },
                    error = null,
                )
            }
        }
    }

    internal fun clearMihoyoLogin() {
        pendingMihoyoQr = null
        pendingMihoyoCookie = null
        requireMihoyoSessionStore().clear()
        updateState {
            copy(
                mihoyoQrUrl = null,
                mihoyoQrStatus = "",
                mihoyoRoles = emptyList(),
                mihoyoSessionSaved = false,
                message = "已退出米游社并删除本机加密登录状态。",
                error = null,
            )
        }
    }

    internal fun generateMihoyoLink(role: MihoyoRole) {
        if (!role.supportsMihoyoGachaLink()) {
            updateState { copy(error = MIHOYO_STAR_RAIL_UNSUPPORTED) }
            return
        }
        val cookie = pendingMihoyoCookie ?: run {
            updateState { copy(error = "米游社登录信息已清理，请重新登录") }
            return
        }
        runTask("正在为 ${role.game.label} ${role.uid} 生成链接…") {
            val link = accountClient.generateLink(cookie, role)
            pendingMihoyoCookie = null
            postState { copy(mihoyoRoles = emptyList()) }
            postLink(link, "米游社链接已生成；临时 Cookie 已从内存清理，登录状态仍在本机加密保存")
        }
    }

    internal fun dismissMihoyoRoles() {
        pendingMihoyoCookie = null
        updateState { copy(mihoyoRoles = emptyList()) }
    }

    internal fun importUigf() {
        val currentActivity = activity ?: return
        DocumentPickerFragment.attach(currentActivity).openJson { uri ->
            if (uri != null) runTask("正在导入并合并 UIGF…") {
                val raw = currentActivity.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                    ?: throw IOException("无法读取所选文件")
                val bundles = UigfCodec.decode(raw)
                val result = requireStore().merge(bundles)
                refreshFromStore(state.value.selectedAccountKey ?: bundles.first().account.key)
                postState {
                    copy(
                        busy = false,
                        progress = "",
                        message = "导入完成：${result.accounts} 个账号，新增 ${result.inserted} 条，已有 ${result.skipped} 条。",
                        error = null,
                    )
                }
            }
        }
    }

    internal fun exportUigf(game: GameKind? = null) {
        val currentActivity = activity ?: return
        val accounts = requireStore().accounts().filter { game == null || it.game == game }
        if (accounts.isEmpty()) {
            updateState { copy(error = "没有可导出的${game?.label?.let { "$it " }.orEmpty()}本地账号") }
            return
        }
        updateState { copy(busy = true, progress = "正在整理 UIGF v4.2…", error = null, message = null) }
        executor.submit {
            try {
                val text = UigfCodec.encode(accounts.map { GachaBundle(it, requireStore().records(it)) }, BuildConfig.VERSION_NAME)
                currentActivity.runOnUiThread {
                    val scope = game?.code ?: "all"
                    DocumentPickerFragment.attach(currentActivity).createJson("uigf-$scope-${fileTimestamp()}.json") { uri ->
                        if (uri == null) {
                            updateState { copy(busy = false, progress = "") }
                        } else {
                            executor.submit {
                                try {
                                    currentActivity.contentResolver.openOutputStream(uri, "wt")?.bufferedWriter(Charsets.UTF_8)?.use { it.write(text) }
                                        ?: throw IOException("无法写入所选文件")
                                    postState {
                                        copy(
                                            busy = false,
                                            progress = "",
                                            message = "${game?.label ?: "全部游戏"} UIGF v4.2 已导出。",
                                            error = null,
                                        )
                                    }
                                } catch (error: Throwable) {
                                    postError(error)
                                }
                            }
                        }
                    }
                }
            } catch (error: Throwable) {
                postError(error)
            }
        }
    }

    internal fun deleteSelectedAccount() {
        val account = selectedAccount() ?: return
        runTask("正在删除本地记录…") {
            requireStore().deleteAccount(account)
            refreshFromStore(null)
            postState { copy(busy = false, progress = "", message = "已删除 ${account.displayName} 的本地记录。", error = null) }
        }
    }

    internal fun openUigfWebsite() {
        activity?.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://uigf.org/zh/standards/uigf.html")))
    }

    internal fun isShizukuReady(): Boolean = host?.isShizukuReady == true
    internal fun hasShizukuPermission(): Boolean = host?.hasShizukuPermission() == true
    internal fun isShellConnected(): Boolean = host?.isShellServiceConnected == true

    override fun onSelected() = Unit

    override fun onHostStateChanged() = updateState { copy(hostRevision = hostRevision + 1) }

    override fun onDestroy() {
        if (pendingMihoyoCookie != null) clearWebCookies()
        executor.shutdownNow()
        store?.close()
        mihoyoSessionStore = null
        currentLink = null
        pendingMihoyoCookie = null
        pendingMihoyoQr = null
        captureStartedAt = null
        synchronized(snapshotCache) { snapshotCache.clear() }
        rootView = null
        activity = null
        host = null
    }

    private fun initialize() = runTask("正在读取本地数据…") {
        val accounts = requireStore().accounts()
        val preferred = preferences().getString(PREF_SELECTED_ACCOUNT, null)
        val selected = accounts.firstOrNull { it.key == preferred } ?: accounts.firstOrNull()
        val snapshot = selected?.let(::loadLocalSnapshot)
        val hasMihoyoSession = requireMihoyoSessionStore().hasSession()
        postState { withLocalSnapshot(accounts, selected, snapshot).copy(mihoyoSessionSaved = hasMihoyoSession) }
    }

    private fun refreshFromStore(preferredKey: String?) {
        synchronized(snapshotCache) { snapshotCache.clear() }
        val accounts = requireStore().accounts()
        val selected = accounts.firstOrNull { it.key == preferredKey } ?: accounts.firstOrNull()
        val snapshot = selected?.let(::loadLocalSnapshot)
        selected?.let { preferences().edit().putString(PREF_SELECTED_ACCOUNT, it.key).apply() }
        postState { withLocalSnapshot(accounts, selected, snapshot) }
    }

    private fun loadLocalSnapshot(account: GachaAccount): LocalAccountSnapshot {
        synchronized(snapshotCache) { snapshotCache[account.key] }?.let { return it }
        val records = requireStore().records(account)
        val snapshot = GachaAnalysis.snapshot(account.game, records, customLossNames(account), account.timezone)
        synchronized(snapshotCache) { snapshotCache[account.key] = snapshot }
        return snapshot
    }

    private fun customLossNames(account: GachaAccount): Set<String> {
        if (account.game != GameKind.STAR_RAIL) return emptySet()
        return preferences().getStringSet(customLossPreferenceKey(account), emptySet()).orEmpty().toSet()
    }

    private fun customLossPreferenceKey(account: GachaAccount): String = "$PREF_STAR_RAIL_LOSS_NAMES:${account.uid}"

    private fun setLink(link: GachaLink, message: String) {
        currentLink = link
        updateState {
            copy(
                busy = false,
                progress = "",
                hasLink = true,
                linkSummary = link.summary(),
                message = message,
                error = null,
            )
        }
    }

    private fun postLink(link: GachaLink, message: String) {
        activity?.runOnUiThread { setLink(link, message) }
    }

    private fun extractLatestLink(log: String): GachaLink? {
        val normalized = log.replace("\\u0026", "&", true).replace("\\/", "/").replace("&amp;", "&")
        val candidates = Regex("https?://[^\\s\\\"'<>]+", RegexOption.IGNORE_CASE).findAll(normalized).toList().asReversed()
        for (candidate in candidates) {
            try {
                return GachaLinkParser.parse(candidate.value)
            } catch (_: Throwable) {
                // 继续尝试更早的候选链接。
            }
        }
        return null
    }

    private fun clearWebCookies() {
        activity?.runOnUiThread {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
        }
    }

    private fun runTask(progress: String, task: () -> Unit) {
        updateState { copy(busy = true, progress = progress, message = null, error = null) }
        executor.submit {
            try {
                task()
            } catch (error: Throwable) {
                postError(error)
            }
        }
    }

    private fun postError(error: Throwable) {
        postState {
            copy(
                busy = false,
                progress = "",
                shizukuCapturing = false,
                error = error.message?.take(300) ?: "操作失败",
                message = null,
            )
        }
    }

    private fun updateState(block: GachaUiState.() -> GachaUiState) {
        val currentActivity = activity
        if (currentActivity == null || currentActivity.isFinishing) return
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            state.value = state.value.block()
        } else {
            currentActivity.runOnUiThread { state.value = state.value.block() }
        }
    }

    private fun postState(block: GachaUiState.() -> GachaUiState) = updateState(block)

    private fun requireStore(): GachaStore = checkNotNull(store) { "本地数据库尚未初始化" }
    private fun requireApiClient(): GachaApiClient = checkNotNull(apiClient) { "网络组件尚未初始化" }
    private fun requireMihoyoSessionStore(): MihoyoSessionStore =
        checkNotNull(mihoyoSessionStore) { "米游社登录存储尚未初始化" }
    private fun preferences() = checkNotNull(activity).getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
    private fun fileTimestamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())

    companion object {
        private const val PREFS_NAME = "gacha-analysis-preferences"
        private const val PREF_SELECTED_ACCOUNT = "selected-account"
        private const val PREF_STAR_RAIL_LOSS_NAMES = "star-rail-loss-names"
        private val LOGCAT_TIME = Regex("\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}")
    }
}
