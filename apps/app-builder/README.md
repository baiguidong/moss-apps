# 应用构建

Moss 内置 App，默认全局按需加载。用户在主会话描述需求，即可创建、迭代、构建、预览和安装 App；无需先选择 App。复用现有的五个 builder_* 工具和 Core 的源码快照、固定 SDK、隔离预览及安装回执。

通用详情展示基本信息、设置、技能、工具和资源；“打开”进入已有创建/继续项目工作台。工作台保留需求草稿、技能多选、助手单选和 @ 搜索。新增 app-creator 技能引导主会话创建，不另建创建器。普通技能创建/安装分别交给 Moss 内置 skill-creator / skill-installer。

新项目默认以主会话工具为中心，无业务工作台就不写 UI。builder_inspect guidance 提供中文说明、场景 Manifest 和 scaffold.mjs。将 scaffold.mjs 与 app.moss.json 放到同一目录，指定 builder_prepare 返回的项目路径，可以生成完整、可构建的文本统计示例；所有写入拒绝覆盖。示例用于验证工具链，继续实现实际需求后再交付。

本版本要求 Host API >=3.22，navigation.location=details，toolScope=global，toolLoading=on-demand。一般 App 根据用途选择 session/global，global 支持 on-demand/always。已安装 App 编辑保留源码、SDK、锁文件、身份、配置与数据；新能力需明确迁移工具链。

SDK 来源和哈希记录在 assets/core-sdk-provenance.json。有意升级 Core 后运行 `node scripts/sync-core-sdk.mjs`、`node scripts/generate-tool-schemas.mjs`，检查并构建。`bun run check`、`bun run test`、`bun run build`；仓库根目录 `node scripts/package-app.mjs --app moss.app-builder` 生成含源码的安装包。

`test:browser` / `test:desktop` 使用隔离 Electron 验证真实 UI 和 Core 流程；`test:agent` 需要显式提供 MOSS_BUILDER_AGENT_SETTINGS，才运行真实模型。Core 的 ui/tests/app-builder-scaffold.test.mjs 验证导出 SDK、脚手架、真实构建、不可覆盖及 Backend 成功/失败行为。完整桌面验证覆盖通用详情、技能说明和主会话入口，不使用用户日常 Profile。
