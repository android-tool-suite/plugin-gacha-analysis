# 跃迁与祈愿分析

Android Tool Suite 的原神 / 崩坏：星穹铁道抽卡记录插件。

插件是 format v3 Web Tool，不携带 `plugin.apk`，也不依赖某个指定的系统插件。若安装了提供通用“近期系统日志”能力的 Provider，可把它作为一种可选的链接获取方式。

## 功能

- 近期系统日志、官方云游戏、手动粘贴，以及原神国服米游社登录四种链接获取方式；米游社登录状态保存在宿主的安全存储与敏感 Dataset 中。星铁请使用前三种方式。
- 获取记录按钮位于链接输入旁，粘贴后可直接获取；日志或米游社角色获得链接后自动回到此卡片。日志默认搜索系统仍保留的全部记录，可选择 5 分钟、30 分钟、2 小时或 24 小时；已被系统覆盖的日志无法恢复。
- AuthKey 链接仅保留在当前内存中，获取成功后继续保留，直到清除／更换链接或关闭工具；可主动复制，不写入数据库或日志。
- 原神与星穹铁道所有现行卡池的增量同步、本地长期保存和多账号切换；千星奇域首次补齐后保存完整标记，后续只读取到本地连续边界。
- “获取新记录”会扫描完整页并回看已知记录：越过首个重复记录的同时间批次、连续两页完全已知后才停止，减少十连记录延迟出现造成的漏记。
- “刷新全部记录”忽略增量边界，完整读取当前链接账号各卡池中接口仍可返回的记录，再去重合并；可修复更早的缺口，不删除本地已有的长期历史。接口尚未返回或已过查询期的记录无法凭此恢复。
- 卡池保底进度、欧非与 UP/歪统计、平均 UP、目标星级时间线与完整记录列表；可按 UID 选择记录字段、社区卡池历史和本地推断来源，星铁仍支持自选额外可歪角色。
- UIGF v4.2 导入、导出、去重合并；兼容导入 UIGF v3 与 SRGF v1。

## 构建

需要 Node.js 24、JDK 17 和 Gradle 8.9 或更高版本：

```powershell
gradle -p plugins\gacha-analysis clean testDebugUnitTest collectArtifacts
```

产物位于 `artifacts/gacha-analysis.atsplugin`。

## 发布通道

- 日常 CI 只测试、构建并上传产物。Debug 通过本地构建和 ADB 导入进行调试，不发布远程版本或调试索引。
- 推送 `v<versionName>` 标签后，工作流测试、构建并发布正式 Release。
- 两种发布都会生成带通道信息的元数据和校验和，并通过 GitHub App 短时令牌发送事件通知插件索引更新。
- `data-compatibility.json` 声明当前构建可能写入的数据格式及可读取范围；修改数据库或设置格式时必须同步递增并评估兼容范围，宿主据此决定是否允许历史版本降级。

## 数据与安全

- 四类 Dataset 位于宿主应用私有目录，记录使用 `(game, uid, normalizedPool, id)` 唯一键合并。星铁普通与联动接口可能返回相同 ID 的不同记录，不能只用 UID 和 ID 去重；原始 ID 不改写，导入导出和保底序号使用同一身份规则。
- 分析链接相当于临时凭据，请勿发送给不可信的人或服务。
- 米游社方式仅支持原神国服；星铁的账号令牌无法生成可用记录链接。登录 Cookie 通过宿主 SecretStore 保存并归入敏感 Dataset，退出登录会同时删除两处状态。
- “近期系统日志”是宿主的通用受限 Capability；本插件仅声明两个固定检索词并接收匹配行，能力契约本身不包含抽卡业务语义。
- 抽卡接口是社区整理的非公开接口，米哈游更新后可能需要同步调整。
- Paimon.moe 与 Star Rail Station 仅在发布前用于生成精简历史快照；插件运行时不请求这些第三方服务。输入版本、时间和哈希记录在 `metadata/banner-history-sources.lock.json`。

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
