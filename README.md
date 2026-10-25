# 跃迁与祈愿分析

Android Tool Suite 的原神 / 崩坏：星穹铁道抽卡记录插件。

插件是 format v3 Web Tool，不携带 `plugin.apk`，也不依赖某个指定的系统插件。若安装了提供通用“近期系统日志”能力的 Provider，可把它作为一种可选的链接获取方式。

## 功能

- 近期系统日志、官方云游戏、手动粘贴，以及原神国服米游社登录四种链接获取方式；米游社登录状态保存在宿主的安全存储与敏感 Dataset 中。星铁请使用前三种方式。
- 获取记录按钮位于链接输入旁，粘贴后可直接获取；日志或米游社角色获得链接后自动回到此卡片。日志默认搜索系统仍保留的全部记录，可选择 5 分钟、30 分钟、2 小时或 24 小时；已被系统覆盖的日志无法恢复。
- AuthKey 链接按游戏和已确认账号保存在本机加密的敏感缓存中；明确失效或手动清除后删除。可主动复制，不写入日志，也不会因资料更新自动使用。
- 原神与星穹铁道所有现行卡池的增量同步、本地长期保存和多账号切换；千星奇域首次补齐后保存完整标记，后续只读取到本地连续边界。
- “获取新记录”会扫描完整页并回看已知记录：越过首个重复记录的同时间批次、连续两页完全已知后才停止，减少十连记录延迟出现造成的漏记。
- “刷新全部记录”忽略增量边界，完整读取当前链接账号各卡池中接口仍可返回的记录，再去重合并；可修复更早的缺口，不删除本地已有的长期历史。接口尚未返回或已过查询期的记录无法凭此恢复。
- 卡池保底进度、欧非与 UP/歪统计、平均 UP、目标星级时间线与完整记录列表；可按 UID 选择记录字段、社区卡池历史和本地推断来源，星铁仍支持自选额外可歪角色。
- UIGF v4.2 导入、导出、去重合并；兼容导入 UIGF v3 与 SRGF v1。
- 概览的统计设置旁提供“游戏资料”：所有账号共用公开排期和物品资料，分别更新原神与星铁；失败保留已校验缓存，离线仍可使用内置资料。可主动启用每七天一次的前台自动检查。
- 分布支持月份、版本、期次与独立卡池。国服历史祈愿、集录与跃迁资料用于时间归类；原神 301/400 按公开子池标注与国服公告核对，保留的原始子池类型可用于旧记录和 UIGF，不要求额外来源标记。原始类型与同期开池出货不符时，继续显示记录所指卡池，并在同账号、同期开池、同原始类型及来源范围标注“可能错误”；疑似错配不自动判成非 UP，正常歪金不触发该提示；星铁按原始卡池 ID 独立分组。不通过获得的角色反推整段记录的卡池。
- 已有记录可以在主动同步或导入时补齐缺失字段，保留原始 false、0、时间与版本证据；冲突和人工 UP 修订在记录详情处理，完整备份保存扩展证据与统计设置。

## 构建

需要 Node.js 24、JDK 17 和 Gradle 8.9 或更高版本：

```powershell
gradle -p plugins\gacha-analysis clean testDebugUnitTest collectArtifacts
```

产物位于 `artifacts/gacha-analysis.atsplugin`。

## 发布通道

- 日常 CI 只测试、构建并上传产物。Debug 通过本地构建和 ADB 导入进行调试，不发布远程版本或调试索引。
- 推送 `v<versionName>` 标签后，工作流测试、构建并发布正式 Release。
- 正式发布生成带通道信息的元数据和校验和，并通过 GitHub App 短时令牌发送事件通知插件索引更新。
- `data-compatibility.json` 声明当前构建可能写入的数据格式及可读取范围；修改数据库或设置格式时必须同步递增并评估兼容范围，宿主据此决定是否允许历史版本降级。

## 数据与安全

- 七项 Dataset 位于宿主应用私有目录，记录使用 `(game, uid, normalizedPool, id)` 唯一键合并。星铁普通与联动接口可能返回相同 ID 的不同记录，不能只用 UID 和 ID 去重；原始 ID 不改写，导入导出和保底序号使用同一身份规则。
- 分析链接相当于临时凭据，请勿发送给不可信的人或服务。
- 米游社方式仅支持原神国服；星铁的账号令牌无法生成可用记录链接。登录 Cookie 通过宿主 SecretStore 保存并归入敏感 Dataset，退出登录会同时删除两处状态。
- “近期系统日志”是宿主的通用受限 Capability；本插件仅声明两个固定检索词并接收匹配行，能力契约本身不包含抽卡业务语义。
- 抽卡接口是社区整理的非公开接口，米哈游更新后可能需要同步调整。
- 公开游戏资料通过已声明的网络权限读取 Paimon.moe、UIGF CurrentBannerWatcher、HoYoLAB 官方配置／公告、国服官方公告与 BWIKI 版本日期、Star Rail Station 和 StarRailRes。资料请求不使用用户 UID、记录或凭据。`metadata/reference-data-sources.lock.json` 记录内置快照的来源与哈希；历史兼容快照继续保留原锁定信息。
- `genshin-reference` 与 `starrail-reference` 是可重新获取的公开缓存，各自原子提交、最多保留三份修订；整体缓存仅支持替换。记录、人工修订与凭据继续使用原有独立 Dataset，不随资料更新改写。
- 标准 UIGF 按对应规范导出，不添加自定义 UP、版本和字段来源；完整宿主备份保存这些证据。标准中的原始 `gacha_type` 继续参与匹配，`uigf_gacha_type` 仅用于共享保底类别。缺少原始池 ID、时间信息或已经合并子池的旧文件无法从公共资料无损恢复当年的选择；重新导入不能消除本期记录自身的归属歧义。官方原始字段、明确非 UP 标记及按版本核验的常驻资格分别保留，不把这些记录误当作歧义证据。

内置资料可从已保存的公开响应重建（不会执行远端 JavaScript）：

```powershell
node plugins/gacha-analysis/tools/generate-reference-bundle.mjs temp/gacha-reference
```

国服版本使用独立的版本日期与官方更新公告；海外排期不用于国服时间判断；目录中的原始 ID 与国服名单、开池日期交叉核对后才使用具名身份。当前版本覆盖到资料实际确认的时间，不推算结束。版本、期次、卡池身份与 UP 分别核验。普通两期按实际换池时间显示上下半，三期及延长版本按真实排期处理；不均分版本周期。星铁有明确原始 ID 时仍可分组，未核验名称只显示 ID，不据此推断排期或 UP。组合卡池的成员身份与所选 UP 规则分开处理；缺少目标规则时只采用记录自身标记或人工修订。原始明细始终保留。传统常驻、新手池分别展示；千星颂愿保存有效档期 ID 时按原始档期分组，不混入普通活动期次。常驻资格尚未收录时不据此判断 UP，不以物品字典的收录推断已实装或已加入常驻。进入账号管理不读取另一游戏全部记录或重算当前账号，分布和明细复用排期与排序索引。

本插件支持 [UIGF v4.2](https://uigf.org/zh/standards/uigf.html) 数据交换格式。

## 开源方案调研

- [Genshin Wish Export](https://github.com/biuuu/genshin-wish-export)：参考 AuthKey 查询参数规范、分页游标、增量停止和五星抽数统计。
- [HoYo.Gacha](https://github.com/lgou2w/HoYo.Gacha)：参考星铁普通池与联动池分别使用 `getGachaLog`、`getLdGachaLog` 的现行公开记录网关。
- [mihoyo-api-collect](https://github.com/UIGF-org/mihoyo-api-collect/blob/main/hoyolab/user/token.md)：参考米游社 `binding/api/genAuthKey` 的当前域名、请求体和 AuthKey 类型。
- [PityPal](https://github.com/sarpowsky/PityPal)：参考“当前保底进度 + 记录筛选 + 单条记录保底序号”的信息结构。
- [HoYoGet](https://www.wyylkjs.com/HoYoGet/docs/site/adbGet/)：参考 Android 上通过 Shizuku 日志与官方云游戏取得链接的交互流程。
- [UIGF v4.2](https://uigf.org/zh/standards/uigf.html)：作为本地导入导出的唯一新格式；旧 UIGF/SRGF 仅作为导入兼容层。
- [Paimon.moe](https://github.com/MadeBaruna/paimon-moe)：提供原神角色与武器活动祈愿时间和 UP 名单，按固定快照转换为物品 ID。
- [Star Rail Station](https://starrailstation.com/)：提供星铁跃迁 ID、时间和 UP 物品 ID，裁剪后随插件打包。

插件没有复制上述项目的界面资源或业务源码；界面使用 Android Tool Suite 共享设计系统重新实现。

可对本地抽卡 Dataset 副本执行只读覆盖核对，检查历史期次、原始 ID 分组、筛选后的统计与明细一致性，不输出 UID 或原始记录：

```powershell
node plugins/gacha-analysis/tools/verify-reference-coverage.mjs <包含-genshin-records.json-与-starrail-records.json-的目录>
```
