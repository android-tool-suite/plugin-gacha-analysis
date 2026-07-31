@file:Suppress("SetJavaScriptEnabled")

package com.androidtoolsuite.app.plugins.gacha

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.androidtoolsuite.app.ui.EmptyState
import com.androidtoolsuite.app.ui.Notice
import com.androidtoolsuite.app.ui.SectionHeader
import com.androidtoolsuite.app.ui.SuiteCard
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import java.util.Locale

@Composable
internal fun GachaAnalysisScreen(plugin: GachaAnalysisPlugin) {
    val ui by plugin.state
    ui.browserMode?.let { mode -> EmbeddedBrowserDialog(mode, plugin) }
    ui.mihoyoQrUrl?.let { url -> MihoyoQrDialog(url, ui.mihoyoQrStatus, plugin) }
    if (ui.mihoyoRoles.isNotEmpty()) MihoyoRoleDialog(ui.mihoyoRoles, plugin)

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        AccountSelector(ui, plugin)
        ScrollableTabRow(selectedTabIndex = ui.page.ordinal, edgePadding = 0.dp, divider = {}) {
            GachaPage.entries.forEach { page ->
                Tab(
                    selected = ui.page == page,
                    onClick = { plugin.selectPage(page) },
                    text = { Text(page.label) },
                )
            }
        }
        if (ui.busy) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Text(ui.progress, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        ui.error?.let { StatusNotice(it, true, plugin::dismissNotice) }
        ui.message?.let { StatusNotice(it, false, plugin::dismissNotice) }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (ui.page) {
                GachaPage.OVERVIEW -> OverviewPage(ui, plugin)
                GachaPage.RECORDS -> RecordsPage(ui, plugin)
                GachaPage.ACQUIRE -> AcquirePage(ui, plugin)
                GachaPage.DATA -> DataPage(ui, plugin)
            }
        }
    }
}

@Composable
private fun AccountSelector(ui: GachaUiState, plugin: GachaAnalysisPlugin) {
    if (ui.accounts.isEmpty()) {
        Text(
            "尚无本地账号 · 请从“获取”或“数据”开始",
            modifier = Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        LazyRow(
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(ui.accounts, key = GachaAccount::key) { account ->
                FilterChip(
                    selected = ui.selectedAccountKey == account.key,
                    onClick = { plugin.selectAccount(account.key) },
                    label = { Text(account.displayName) },
                    enabled = !ui.busy,
                )
            }
        }
    }
}

@Composable
private fun StatusNotice(text: String, warning: Boolean, onDismiss: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Notice(text, warning = warning)
        TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("知道了") }
    }
}

@Composable
private fun OverviewPage(ui: GachaUiState, plugin: GachaAnalysisPlugin) {
    val account = plugin.selectedAccount()
    val stats = ui.poolStats
    if (account == null) {
        EmptyState("还没有抽卡记录", "前往“获取”粘贴或捕获链接，也可以在“数据”中导入 UIGF 文件。")
        return
    }
    var selectedPoolType by remember(account.key, stats.map { it.pool.type }) {
        mutableStateOf(stats.firstOrNull()?.pool?.type)
    }
    val selectedStats = stats.firstOrNull { it.pool.type == selectedPoolType } ?: stats.firstOrNull()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionHeader(account.displayName, "${ui.records.size} 条本地记录 · 时区 UTC${signedTimezone(account.timezone)}")
        }
        if (stats.isEmpty()) item { EmptyState("账号暂无记录", "获取新记录或导入包含该 UID 的 UIGF 文件。") }
        if (stats.isNotEmpty()) {
            item { OverallLuckCard(stats) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(stats, key = { it.pool.type }) { poolStats ->
                        PoolScoreCard(
                            stats = poolStats,
                            selected = selectedStats?.pool?.type == poolStats.pool.type,
                            onClick = { selectedPoolType = poolStats.pool.type },
                        )
                    }
                }
            }
            selectedStats?.let { detail -> item(key = detail.pool.type) { PoolTimelineCard(detail) } }
        }
    }
}

@Composable
private fun OverallLuckCard(stats: List<PoolStats>) {
    val total = stats.sumOf(PoolStats::total)
    val fiveStars = stats.sumOf(PoolStats::count5)
    val upCount = stats.sumOf(PoolStats::upCount)
    val lossCount = stats.sumOf(PoolStats::lossCount)
    SuiteCard {
        Text("本账号欧非判定", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            GachaAnalysis.overallLuck(stats),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        )
        Text("按非常驻池 UP 获取成本评估；“歪”由用户启用的记录字段、社区卡池历史、本地名单与手动标记共同判定。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider(Modifier.padding(vertical = 4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Metric("总抽数", total.toString(), MaterialTheme.colorScheme.primary)
            Metric("五星", fiveStars.toString(), FiveStar)
            Metric("UP", upCount.toString(), LuckyGreen)
            Metric("歪", lossCount.toString(), UnluckyRed)
        }
    }
}

@Composable
private fun PoolScoreCard(stats: PoolStats, selected: Boolean, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.width(166.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(stats.pool.label, maxLines = 2, minLines = 2, fontWeight = FontWeight.Bold)
            Text("${stats.total} 抽", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            if (stats.pool.tracksUp) {
                Text("${stats.upCount} UP · ${stats.lossCount} 歪", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text("${stats.targetCount} 个${stats.pool.targetLabel}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                "${stats.averageLabel} ${if (stats.displayedAverage == 0.0) "—" else String.format(Locale.ROOT, "%.1f", stats.displayedAverage)}",
                color = if (stats.pool.tracksUp) LuckyGreen else MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun PoolTimelineCard(stats: PoolStats) {
    SuiteCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stats.pool.label, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("${stats.total} 抽 · ${stats.targetCount} 个${stats.pool.targetLabel}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${stats.currentPity} 抽", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("当前进度 / ${stats.pool.hardPity}", style = MaterialTheme.typography.labelSmall)
            }
        }
        LinearProgressIndicator(
            progress = { (stats.currentPity.toFloat() / stats.pool.hardPity).coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Metric(
                stats.pool.targetLabel,
                "${stats.targetCount} · ${stats.rate(stats.targetCount)}",
                rarityColor(stats.pool.targetRarity),
            )
            if (stats.pool.tracksUp) {
                Metric("UP / 歪", "${stats.upCount} / ${stats.lossCount}", if (stats.lossCount == 0) LuckyGreen else UnluckyRed)
            } else {
                val secondaryRarity = if (stats.pool.targetRarity == 4) 3 else 4
                val secondaryCount = stats.countForRarity(secondaryRarity)
                Metric("${secondaryRarity}星", "$secondaryCount · ${stats.rate(secondaryCount)}", rarityColor(secondaryRarity))
            }
            Metric(
                stats.averageLabel,
                if (stats.displayedAverage == 0.0) "—" else String.format(Locale.ROOT, "%.1f", stats.displayedAverage),
                MaterialTheme.colorScheme.primary,
            )
        }
        if (stats.targetPulls.isNotEmpty()) {
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Text("${stats.pool.targetLabel}时间线", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            stats.targetPulls.take(30).forEach { pull -> TargetTimelineRow(pull, stats.pool) }
        }
    }
}

@Composable
private fun TargetTimelineRow(pull: TargetPull, pool: GachaPool) {
    val color = luckColor(pull.luck)
    val targetColor = rarityColor(pool.targetRarity)
    Column(
        Modifier.fillMaxWidth().background(color.copy(alpha = .09f), RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(pull.record.name.ifBlank { "未知${pool.targetLabel}" }, color = targetColor, fontWeight = FontWeight.Bold)
                Text(pull.record.time.take(10), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (pull.luck != LuckGrade.NORMAL) LuckBadge(pull.luck.label, color)
            pull.isLoss?.let { loss -> LuckBadge(if (loss) "歪" else "UP", if (loss) UnluckyRed else LuckyGreen) }
            Text("${pull.pity} 抽", modifier = Modifier.padding(start = 8.dp), fontWeight = FontWeight.Bold)
        }
        Box(Modifier.fillMaxWidth().height(8.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(99.dp))) {
            Box(
                Modifier.fillMaxWidth((pull.pity.toFloat() / pool.hardPity).coerceIn(.04f, 1f))
                    .height(8.dp)
                    .background(color, RoundedCornerShape(99.dp)),
            )
        }
    }
}

@Composable
private fun LuckBadge(label: String, color: Color) {
    Text(
        label,
        modifier = Modifier.padding(horizontal = 5.dp),
        color = color,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.labelMedium,
    )
}

@Composable
private fun Metric(label: String, value: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun RecordsPage(ui: GachaUiState, plugin: GachaAnalysisPlugin) {
    val account = plugin.selectedAccount()
    if (account == null) {
        EmptyState("还没有抽卡记录", "获取链接并同步，或先导入 UIGF 文件。")
        return
    }
    var query by remember(account.key) { mutableStateOf("") }
    val pity = ui.pityByRecordId
    val records = ui.records.filter { record ->
        (ui.selectedPoolType == "all" || record.displayPoolType == ui.selectedPoolType) &&
            (ui.selectedRarity == 0 || record.rarity == ui.selectedRarity) &&
            (query.isBlank() || record.name.contains(query, true))
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(40) },
                label = { Text("搜索物品名称") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(ui.selectedPoolType == "all", { plugin.selectPool("all") }, { Text("全部卡池") })
                account.game.pools.forEach { pool ->
                    FilterChip(ui.selectedPoolType == pool.type, { plugin.selectPool(pool.type) }, { Text(pool.label) })
                }
            }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0 to "全部星级", 5 to "五星", 4 to "四星", 3 to "三星").forEach { (rarity, label) ->
                    FilterChip(ui.selectedRarity == rarity, { plugin.selectRarity(rarity) }, { Text(label) })
                }
            }
        }
        item { Text("显示 ${records.size} / ${ui.records.size} 条", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (records.isEmpty()) item { EmptyState("没有匹配记录", "调整卡池、星级或搜索条件。") }
        items(records, key = GachaRecord::id) { record -> RecordCard(record, pity[record.id] ?: 0) }
    }
}

@Composable
private fun RecordCard(record: GachaRecord, pity: Int) {
    val color = rarityColor(record.rarity)
    Card(colors = CardDefaults.cardColors(containerColor = color.copy(alpha = .09f)), shape = RoundedCornerShape(18.dp)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${record.rarity}★", modifier = Modifier.width(42.dp), color = color, fontWeight = FontWeight.Bold)
            Column(Modifier.weight(1f)) {
                Text(record.name.ifBlank { "未知物品" }, color = color, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${record.game.pool(record.displayPoolType).label} · ${record.time}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text("第 $pity 抽", style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun AcquirePage(ui: GachaUiState, plugin: GachaAnalysisPlugin) {
    var manualLink by remember { mutableStateOf("") }
    var manualCookie by remember { mutableStateOf("") }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SuiteCard {
                SectionHeader("当前分析链接", "AuthKey 只保留在本次插件内存中，不写入数据库。")
                Text(ui.linkSummary, color = if (ui.hasLink) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(plugin::copyLink, enabled = ui.hasLink && !ui.busy, modifier = Modifier.weight(1f)) { Text("复制链接") }
                    Button(plugin::syncRecords, enabled = ui.hasLink && !ui.busy, modifier = Modifier.weight(1f)) { Text("获取记录") }
                }
            }
        }
        item {
            SuiteCard {
                SectionHeader("手动粘贴", "支持游戏历史页或 getGachaLog 完整 URL。")
                OutlinedTextField(
                    value = manualLink,
                    onValueChange = { manualLink = it },
                    label = { Text("抽卡分析链接") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 4,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { manualLink = plugin.clipboardText() }, modifier = Modifier.weight(1f)) { Text("从剪贴板粘贴") }
                    Button(
                        onClick = { plugin.setManualLink(manualLink); manualLink = "" },
                        enabled = manualLink.isNotBlank() && !ui.busy,
                        modifier = Modifier.weight(1f),
                    ) { Text("读取链接") }
                }
            }
        }
        item { ShizukuCard(ui, plugin) }
        item {
            SuiteCard {
                SectionHeader("官方云游戏", "在内置 WebView 登录并打开祈愿/跃迁历史，链接会自动捕获。")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { plugin.openCloud(GameKind.GENSHIN) }, enabled = !ui.busy, modifier = Modifier.weight(1f)) { Text("云·原神") }
                    OutlinedButton(onClick = { plugin.openCloud(GameKind.STAR_RAIL) }, enabled = !ui.busy, modifier = Modifier.weight(1f)) { Text("云·星穹铁道") }
                }
                Text("云游戏可能需要排队；部分厂商 WebView 无法运行云游戏。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            SuiteCard {
                SectionHeader("米游社账号（国服，仅原神）", "扫码一次后加密保持登录，可快速刷新原神角色并生成临时抽卡链接。")
                Notice("星穹铁道的米游社登录态无法生成可用抽卡 AuthKey，请使用 Shizuku、官方云游戏或手动粘贴链接。", warning = true)
                if (ui.mihoyoSessionSaved) {
                    Notice("已使用 Android Keystore 在本机加密保存登录状态。")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = plugin::useSavedMihoyoLogin,
                            enabled = !ui.busy,
                            modifier = Modifier.weight(1f),
                        ) { Text("读取已登录账号") }
                        OutlinedButton(
                            onClick = plugin::clearMihoyoLogin,
                            enabled = !ui.busy,
                            modifier = Modifier.weight(1f),
                        ) { Text("退出登录") }
                    }
                }
                Button(onClick = plugin::openMihoyoLogin, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (ui.mihoyoSessionSaved) "重新扫码登录" else "米游社扫码登录")
                }
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                Text("高级备用：粘贴包含 SToken 的米游社 Cookie", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = manualCookie,
                    onValueChange = { manualCookie = it },
                    label = { Text("米游社 Cookie") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 3,
                )
                OutlinedButton(
                    onClick = { plugin.useMihoyoCookies(manualCookie); manualCookie = "" },
                    enabled = manualCookie.isNotBlank() && !ui.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("读取 Cookie") }
                Notice("普通网页登录可能缺少 SToken 或 mid，推荐使用扫码登录。成功后 Cookie 只以 Keystore 加密密文保存在本机，可随时退出并删除。", warning = true)
            }
        }
    }
}

@Composable
private fun ShizukuCard(ui: GachaUiState, plugin: GachaAnalysisPlugin) {
    SuiteCard {
        SectionHeader("Shizuku 捕获", "打开游戏历史记录后，从系统日志中筛选链接。")
        val status = when {
            !plugin.isShizukuReady() -> "Shizuku 未连接"
            !plugin.hasShizukuPermission() -> "等待宿主获得 Shizuku 授权"
            !plugin.isShellConnected() -> "等待 UserService 连接"
            ui.shizukuCapturing -> "正在捕获"
            else -> "已就绪"
        }
        Text(status, color = if (plugin.isShellConnected()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = plugin::beginShizukuCapture,
                enabled = !ui.shizukuCapturing && !ui.busy,
                modifier = Modifier.weight(1f),
            ) { Text("开始捕获") }
            Button(
                onClick = plugin::finishShizukuCapture,
                enabled = ui.shizukuCapturing && !ui.busy,
                modifier = Modifier.weight(1f),
            ) { Text("停止并读取") }
        }
    }
}

@Composable
private fun DataPage(ui: GachaUiState, plugin: GachaAnalysisPlugin) {
    var confirmDelete by remember { mutableStateOf(false) }
    val hasGenshin = ui.accounts.any { it.game == GameKind.GENSHIN }
    val hasStarRail = ui.accounts.any { it.game == GameKind.STAR_RAIL }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("删除本地抽卡记录？") },
            text = { Text("只删除当前选中账号的本地记录，无法撤销。建议先导出 UIGF 备份。") },
            confirmButton = { Button(onClick = { confirmDelete = false; plugin.deleteSelectedAccount() }) { Text("确认删除") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } },
        )
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        plugin.selectedAccount()?.let { account ->
            item {
                val availableSources = BannerHistorySource.availableFor(account.game)
                SuiteCard {
                    SectionHeader("UP / 歪判定来源", "按当前 UID 保存；切换后立即重新分析，不会改写原始抽卡记录。")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(availableSources, key = BannerHistorySource::preferenceId) { source ->
                            val selected = source in ui.bannerHistorySources
                            FilterChip(
                                selected = selected,
                                onClick = { plugin.setBannerHistorySource(source, !selected) },
                                label = { Text(source.label) },
                                enabled = !ui.busy,
                            )
                        }
                    }
                    availableSources.forEach { source ->
                        Text(
                            "${source.label}：${source.description}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    val communityCount = when (account.game) {
                        GameKind.GENSHIN -> EmbeddedBannerHistory.PAIMON_MOE_COUNT
                        GameKind.STAR_RAIL -> EmbeddedBannerHistory.STAR_RAIL_STATION_COUNT
                    }
                    Text(
                        "社区快照 ${communityCount} 条 · 更新于 ${EmbeddedBannerHistory.GENERATED_AT.take(10)} · 运行时不连接第三方站点",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Notice("判定优先级：手动可歪角色 > 记录原始字段 > 社区历史 > 本地名单。禁用全部来源后，无法确认的五星会显示为未知。", warning = false)
                }
            }
        }
        if (plugin.selectedAccount()?.game == GameKind.STAR_RAIL) {
            item {
                SuiteCard {
                    SectionHeader("星铁可歪角色", "选择除常驻角色外、也可能替代常驻结果出现的五星角色。")
                    if (ui.customLossCandidates.isEmpty()) {
                        Text("本地角色活动跃迁中还没有可配置的限定五星角色。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(ui.customLossCandidates, key = { it }) { name ->
                                val selected = name in ui.customLossNames
                                FilterChip(
                                    selected = selected,
                                    onClick = { plugin.setCustomLossName(name, !selected) },
                                    label = { Text(name) },
                                    enabled = !ui.busy,
                                )
                            }
                        }
                        Text(
                            "已选择 ${ui.customLossNames.size} 个；按角色名称应用到当前 UID 的历史活动跃迁记录。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Notice("手动选择的优先级最高，同名五星会在该 UID 的历史活动跃迁中计为“歪”；可用于修正社区来源缺口或特殊卡池规则。", warning = true)
                }
            }
        }
        item {
            SuiteCard {
                SectionHeader("UIGF v4.2", "支持多 UID；千星奇域颂愿按标准写入 hk4e_ugc。")
                Button(onClick = plugin::importUigf, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) { Text("导入并合并") }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { plugin.exportUigf(GameKind.GENSHIN) }, enabled = hasGenshin && !ui.busy, modifier = Modifier.weight(1f)) { Text("仅原神") }
                    OutlinedButton(onClick = { plugin.exportUigf(GameKind.STAR_RAIL) }, enabled = hasStarRail && !ui.busy, modifier = Modifier.weight(1f)) { Text("仅星铁") }
                    Button(onClick = { plugin.exportUigf() }, enabled = ui.accounts.isNotEmpty() && !ui.busy, modifier = Modifier.weight(1f)) { Text("全部") }
                }
                TextButton(onClick = plugin::openUigfWebsite, modifier = Modifier.align(Alignment.End)) { Text("查看 UIGF 标准") }
            }
        }
        item {
            SuiteCard {
                SectionHeader("本地保存", "记录 ID 以文本保存并使用 游戏 + UID + ID 去重。")
                Text("${ui.accounts.size} 个账号 · 当前 ${ui.records.size} 条记录")
                Text("同步和导入只合并新记录，不会因为服务器只保留有限历史而删除旧数据。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedButton(
                    onClick = { confirmDelete = true },
                    enabled = plugin.selectedAccount() != null && !ui.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("删除当前账号的本地记录") }
            }
        }
        item { Notice("分析链接与米游社 Cookie 都是敏感凭据。Cookie 只通过 Android Keystore 加密保存在本机；它们不会写入抽卡数据库、UIGF 文件、日志或统计服务。") }
    }
}

@Composable
private fun MihoyoQrDialog(url: String, status: String, plugin: GachaAnalysisPlugin) {
    val bitmap = remember(url) { createQrBitmap(url, 720) }
    Dialog(onDismissRequest = plugin::closeMihoyoQr) {
        Card(shape = RoundedCornerShape(24.dp)) {
            Column(
                Modifier.fillMaxWidth().padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("米游社扫码登录", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("使用米游社 App 扫描并确认", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = "米游社登录二维码",
                    modifier = Modifier.size(252.dp).background(Color.White, RoundedCornerShape(16.dp)).padding(10.dp),
                )
                Text(status.ifBlank { "等待米游社扫码确认" }, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("推荐用另一台设备的米游社扫码；同机也可打开扫码页完成确认，返回后会继续轮询。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = plugin::openMihoyoQrExternally, modifier = Modifier.fillMaxWidth()) { Text("在本机打开扫码页") }
                TextButton(onClick = plugin::closeMihoyoQr, modifier = Modifier.fillMaxWidth()) { Text("取消") }
            }
        }
    }
}

private fun createQrBitmap(content: String, size: Int): Bitmap {
    val matrix = MultiFormatWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size)
    for (y in 0 until size) {
        val offset = y * size
        for (x in 0 until size) pixels[offset + x] = if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE
    }
    return Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).apply {
        setPixels(pixels, 0, size, 0, 0, size, size)
    }
}

@Composable
private fun MihoyoRoleDialog(roles: List<MihoyoRole>, plugin: GachaAnalysisPlugin) {
    Dialog(onDismissRequest = plugin::dismissMihoyoRoles) {
        Card(shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("选择原神角色", style = MaterialTheme.typography.titleLarge)
                Text("生成链接后，临时 Cookie 会从内存清理；加密登录状态会保留，便于下次快速获取。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                roles.forEach { role ->
                    OutlinedButton(onClick = { plugin.generateMihoyoLink(role) }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text("${role.game.label} · ${role.nickname.ifBlank { role.uid }}", fontWeight = FontWeight.Bold)
                            Text("${role.regionName.ifBlank { role.region }} · UID ${role.uid} · Lv.${role.level}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                TextButton(onClick = plugin::dismissMihoyoRoles, modifier = Modifier.align(Alignment.End)) { Text("取消") }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun EmbeddedBrowserDialog(mode: BrowserMode, plugin: GachaAnalysisPlugin) {
    val context = LocalContext.current
    var webView by remember(mode) { mutableStateOf<WebView?>(null) }
    val title = when (mode) {
        BrowserMode.CLOUD_GENSHIN -> "云·原神 · 打开祈愿历史"
        BrowserMode.CLOUD_STAR_RAIL -> "云·星穹铁道 · 打开跃迁历史"
    }
    val startUrl = when (mode) {
        BrowserMode.CLOUD_GENSHIN -> GameKind.GENSHIN.cloudUrl
        BrowserMode.CLOUD_STAR_RAIL -> GameKind.STAR_RAIL.cloudUrl
    }
    DisposableEffect(mode) {
        onDispose {
            webView?.stopLoading()
            webView?.destroy()
            webView = null
        }
    }
    Dialog(onDismissRequest = { plugin.closeBrowser() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Card(modifier = Modifier.fillMaxWidth(.98f).fillMaxHeight(.96f), shape = RoundedCornerShape(22.dp)) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    TextButton(onClick = { plugin.closeBrowser() }) { Text("关闭") }
                }
                HorizontalDivider()
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = {
                        WebView(context).apply {
                            webView = this
                            setBackgroundColor(AndroidColor.BLACK)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.mediaPlaybackRequiresUserGesture = false
                            settings.allowContentAccess = true
                            settings.allowFileAccess = false
                            CookieManager.getInstance().setAcceptCookie(true)
                            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                            webChromeClient = object : WebChromeClient() {
                                override fun onPermissionRequest(request: android.webkit.PermissionRequest) = request.deny()
                            }
                            webViewClient = object : WebViewClient() {
                                private fun inspect(url: String?) {
                                    if (url?.contains("authkey=", true) == true) plugin.browserCapturedLink(url)
                                }

                                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                                    inspect(url)
                                    super.onPageStarted(view, url, favicon)
                                }

                                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                    inspect(request?.url?.toString())
                                    return false
                                }

                                @Deprecated("Deprecated in Java")
                                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                                    inspect(url)
                                    return false
                                }

                                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                                    inspect(request?.url?.toString())
                                    return super.shouldInterceptRequest(view, request)
                                }
                            }
                            loadUrl(startUrl)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun rarityColor(rarity: Int): Color = when (rarity) {
    5 -> FiveStar
    4 -> FourStar
    else -> ThreeStar
}

private fun signedTimezone(value: Int): String = if (value >= 0) "+$value" else value.toString()

private fun luckColor(grade: LuckGrade): Color = when (grade) {
    LuckGrade.SUPER_LUCKY, LuckGrade.LUCKY -> LuckyGreen
    LuckGrade.NORMAL -> NormalAmber
    LuckGrade.UNLUCKY, LuckGrade.VERY_UNLUCKY -> UnluckyRed
}

private val FiveStar = Color(0xFFD99A19)
private val FourStar = Color(0xFF8A5CC7)
private val ThreeStar = Color(0xFF3F7DB8)
private val LuckyGreen = Color(0xFF2EAD68)
private val NormalAmber = Color(0xFFD6A326)
private val UnluckyRed = Color(0xFFE85D5D)
