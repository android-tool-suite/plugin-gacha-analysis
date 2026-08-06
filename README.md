# 跃迁与祈愿分析

Android Tool Suite 的原神 / 崩坏：星穹铁道抽卡记录插件。

插件依赖宿主内置的 `shizuku_auth`，由宿主插件管理器负责启用顺序与依赖保护。

## 功能

- Shizuku 日志、官方云游戏、手动粘贴，以及原神国服米游社登录四种链接获取方式；米游社登录状态可在本机加密保持。星铁请使用前三种方式。
- AuthKey 链接仅保留在当前内存中，可由用户主动复制，不写入数据库或日志。
- 原神与星穹铁道所有现行卡池的增量同步、本地长期保存和多账号切换；千星奇域首次补齐后保存完整标记，后续只读取到本地连续边界。
- 卡池保底进度、欧非与 UP/歪统计、平均 UP、目标星级时间线与完整记录列表；可按 UID 选择记录字段、社区卡池历史和本地推断来源，星铁仍支持自选额外可歪角色。
- UIGF v4.2 导入、导出、去重合并；兼容导入 UIGF v3 与 SRGF v1。

## 构建

先发布宿主插件 SDK，再构建插件：

```powershell
gradle -p app :plugin-sdk:publishReleasePublicationToPluginSdkRepository
gradle -p plugins\gacha-analysis `
  "-PatsSdkRepository=..\..\app\plugin-sdk\build\repository" `
  clean testDebugUnitTest collectArtifacts
```

产物位于 `artifacts/gacha-analysis.atsplugin`。

## 发布通道

- 推送 `main` 并通过单元测试与构建后，工作流更新滚动 `debug` 预发布，宿主调试仓库随后可自动发现该构建。
- 推送 `v<versionName>` 标签后，工作流测试、构建并发布正式 Release。
- 两种发布都会生成带通道信息的元数据和校验和，并通过 GitHub App 短时令牌发送事件通知插件索引更新。

## 数据与安全

- 本地数据库位于宿主应用私有目录，使用 `(game, uid, id)` 唯一键合并。
- 分析链接相当于临时凭据，请勿发送给不可信的人或服务。
- 米游社方式仅支持原神国服；星铁的 SToken AuthKey 会被记录接口拒绝。登录 Cookie 使用 Android Keystore AES-GCM 加密保存在宿主应用私有目录，生成链接时的临时明文副本会在完成或取消后清理，退出登录会删除密文。
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
