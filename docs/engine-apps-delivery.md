# 开发验证记录

以下保留开发阶段验证详情；正式版本与发布入口见 [初始发布说明](initial-local-apps-release.md)。

# CLI / MCP 引擎 App 交付记录

日期：2026-10-16。三款 App 均采用 `apps/` 普通 Moss App，自有 React UI 和薄 Backend；扫描、转换、代码索引与查询由固定版本开源引擎执行。基础操作不调用大模型，结果在 Moss 内查看。所有固定运行依赖由 CI 准备并放进最终发布 ZIP，首次运行只在本机解压、校验，不下载引擎，无需另装上游 GUI。

## App 与安装包

版本均为 0.1.0，当前验证平台 **macOS Apple Silicon (`darwin-arm64`)**，要求配套 **Moss Host API 3.14**。

| App | 上游引擎 | UI 覆盖 | Agent 入口 | 本地安装包 |
| --- | --- | --- | --- | --- |
| [文件清理](../apps/file-cleaner/README.md) | [Czkawka 12.0.2](https://github.com/qarmin/czkawka/releases/tag/12.0.2) | 全部 14 个子命令、视频优化的转码/裁剪参数；扫描分组、相似图片预览、JSON/TXT 导出 | `moss-file-cleaner` skill | [ZIP](../artifacts/moss.file-cleaner/0.1.0/moss.file-cleaner-0.1.0-darwin-arm64.zip) |
| [文档格式转换](../apps/document-converter/README.md) | [Pandoc 3.12.1](https://github.com/jgm/pandoc/releases/tag/3.12.1) | 52 种输入、77 种输出格式目录，94 项参数表单；逐个/合并转换、模板、引用、媒体提取、格式查询、内容预览与导出 | `moss-document-converter` skill | [ZIP](../artifacts/moss.document-converter/0.1.0/moss.document-converter-0.1.0-darwin-arm64.zip) |
| [代码地图](../apps/code-map/README.md) | [codebase-memory-mcp v0.12.0](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.12.0) | 仓库索引、符号搜索、源码阅读、直接调用关系图、文件与架构查询；全部 17 个工具的参数表单/JSON 编辑 | 原生 MCP tools | [ZIP](../artifacts/moss.code-map/0.1.0/moss.code-map-0.1.0-darwin-arm64.zip) |

安装包路径、字节数和 SHA-256 汇总见 [交付清单](../artifacts/engine-apps/delivery.json)。

ZIP 包含可独立重建的 `source/`、锁文件、构建脚本、固定 SDK 和校验清单。各包经过源码隔离重建及 Backend 握手。此轮产物是本地开发交付，尚未发布应用市场。

## CLI 覆盖和结果边界

文件清理的 14 项：重复文件、空文件夹、大文件、空文件、临时文件、相似图片、重复音频、无效符号链接、损坏文件、相似视频、扩展名检查、文件名检查、视频优化、EXIF 清理。参数从所固定二进制的真实 `--help` 生成，未自己实现扫描/去重算法。原始目录和结果报告路径由 App 管理；其余子命令参数都有表单，另提供逐项高级 argv 编辑。修改原文件需勾选本次允许修改，支持预演的命令可以先 dry run。匹配文件的总大小不等于可释放空间。

视频功能使用安装包内校验后的 FFmpeg 8.0.1 和 ffprobe 5.0.1。HEIF/RAW 等特殊格式以固定上游二进制的实际支持为准。大报告受 16 MiB 限制；UI 限制一次显示的分组/文件数，完整报告可以导出。

Pandoc 的输入、输出、日志和媒体路径由 App 管理；参数表单支持显式启用/关闭可选布尔参数、可选参数的上游默认值、重复参数与自定义样式路径。支持上游 defaults、Lua/filter 等能力，实际转换行为仍遵循 Pandoc。DOCX、ODT、EPUB 等产物由 Pandoc 重新读取，生成沙箱 HTML **内容预览**，不声称是 Office 精确分页排版。PPTX 等上游不能回读的二进制产物目前可导出，不能在本版查看精确版式。PDF 默认使用随包的 Typst 0.15.1，无需安装 TeX；显式选择其他引擎、自定义 filter 或模板时，由用户提供相关文件。不是每一对输入/输出格式都无损兼容。

代码地图只显示上游已记录的直接调用边；图中节点可继续查看源码和关系。其他 MCP 查询的原始结构化结果保留供 UI 和 Agent 阅读。App 通过上游 `CBM_RUNTIME_DIR` 为每个实例分配独立守护进程运行目录；同一实例的 UI 与 Agent 共享索引，并能与用户已有的 codebase-memory-mcp 并行运行。

## Agent 和页面共享结果

CLI App 不伪装成 MCP 服务。Manifest 的 `contributes.skills` 声明随包 skill 和 CLI，Core 在所选会话注入当前安装版本的 `skillPath`、`cliPath`、`dataDir`、`nodeExecutable`、`nodeArgs` 与 `env`。CLI 使用 Moss 的 Node 运行时，用户无需另外安装 Node。

```text
node <cliPath> --data-dir <dataDir> describe
node <cliPath> --data-dir <dataDir> list
node <cliPath> --data-dir <dataDir> show <task-id>
node <cliPath> --data-dir <dataDir> run --input-file <absolute-request.json>
node <cliPath> --data-dir <dataDir> cancel <task-id>
```

这里 `node` 代表上下文提供的运行时，按 `nodeArgs` 和 `env` 启动。每次执行保留原始请求、实际 argv、日志、状态和产物；失败返回非零退出码。Agent 可以在 UI 不可用时读取失败任务，修正 JSON 参数后通过独立 CLI 重跑。页面轮询同一任务目录；历史记录保留新旧任务，支持回填参数。批量部分失败返回 `partial` 并保留成功文件，全失败返回 `failed`。

代码地图通过 `moss.mcp/v1` 注册 stdio 服务，代理上游 `tools/list`、`tools/call`，将 Agent 调用记录为 `agent-tool`，原始返回保持可读。只有选中/全局启用的 App 对会话可发现；停用后不再注入 skill 或 MCP 服务。这里验证的是 Agent 实际使用的执行入口，没有用大模型生成结果冒充上游执行。

共享包 [packages/engine-apps](../packages/engine-apps/) 只提供运行时准备、无 shell 的 argv 调用、任务存储、取消、文件预览/导出及 UI 组件。构建期下载和运行期本地解压均校验 SHA-256；运行时没有下载代码，资源缺失/损坏明确报错。HTML 预览使用带随机令牌的本地端口和 CSP 沙箱。

## Core 配套变更

完整 Core 工作树 `/Users/bgd/repo/moss` 已实现；本仓库 `vendor/moss-core` 同步了 SDK 与包校验层。仅本轮变更另存为 [Core 兼容补丁](https://github.com/baiguidong/moss/commit/8e39984889590c162fa23db98ea8c114d6ad71a0)，不包含工作树内其他未提交修改。

- Host API 升至 3.14，校验并保留 `contributes.skills`，拒绝旧 Host 范围和越界路径。
- 安装验证 skill / CLI 文件，限制 skill 文本大小；本版 skill 使用整个 App 的会话选择，不支持子服务选择模式。
- 会话选择、Agent 能力列表、安装信息和导航识别 CLI skill。
- 构造本地会话配置时注入选中 App 的 skill 与实际运行时/数据目录；升级后解析当前版本，停用实例不提供能力。不复制全局 skill。

旧版 Core 无此能力，不能只安装这三个 ZIP 就期望 CLI skill 自动发现。正式发布前需提交/发布 Core，并把子模块固定到包含这些变更的已推送提交；本轮未执行发布。

## 验证与复现

[真实 CLI 报告](../artifacts/engine-apps/verification/cli-report.json) 包含 28 项验证：全部 14 个清理命令、8 种真实文档输出、DOCX/ODT/EPUB 回读、批量部分失败、删除预演/实际删除、H.264 实际转码与 ffprobe 回读、defaults/显式 false/固定输出、DOCX 媒体提取及失败 argv 保留。路径样例含中文、空格、引号和 shell 符号。

三个 App 的实际 Moss UI 验证已完成：文件清理的错误参数通过独立 skill 重跑并回到页面，相似图片真实加载；文档转换产物回读显示标题/表格，直接导出目标 DOCX；代码地图索引、源码与调用图、会话 MCP 工具发现/调用和结果同步。各 App 检查浅色/深色、440px 窄窗口、重启后任务保留、停用后能力不可发现。报告和截图：[文件清理](../artifacts/engine-apps/verification/file-cleaner/report.json)、[文档转换](../artifacts/engine-apps/verification/document-converter/report.json)、[代码地图](../artifacts/engine-apps/verification/code-map/report.json)。

运行时测试覆盖下载、ZIP/TGZ 提取、双重哈希校验、缓存损坏、执行权限修复、参数不经过 shell，以及从另一个任务存储入口取消真实子进程。本轮 9 项 App/运行时/skill 测试、26 项 Core 会话选择/导航测试均通过；三个 App 和 Core UI 的类型检查通过。

```sh
bun run --cwd apps/file-cleaner check
bun run --cwd apps/document-converter check
bun run --cwd apps/code-map check
node --test apps/file-cleaner/tests/*.test.mjs apps/document-converter/tests/*.test.mjs apps/code-map/tests/*.test.mjs scripts/engine-app-runtime.test.mjs scripts/engine-app-skills.test.mjs
node scripts/package-app.mjs --app moss.file-cleaner
node scripts/package-app.mjs --app moss.document-converter
node scripts/package-app.mjs --app moss.code-map
MOSS_ENGINE_FIXTURE_ROOT=/tmp/moss-first-mcp-cli node scripts/verify-engine-clis.mjs
node scripts/verify-engine-ui.mjs
```

`MOSS_CORE_ROOT` 可指定含兼容补丁的完整 Core checkout，默认使用相邻的 `../moss`，UI 验证需要其 Electron 开发依赖。`engine-app-skills.test.mjs` 在没有完整 Core 时跳过两项 Core 集成测试，Manifest 测试仍运行。

`MOSS_ENGINE_FIXTURE_ROOT` 下放置按各 App `resources/*.json` 固定的上游二进制，文件名为 `mac_czkawka_cli_arm64`、`pandoc-bin`、`codebase-memory-mcp-bin`、`ffmpeg-bin`、`ffprobe-bin`。真实验证脚本会先核对哈希，再复制到隔离的 App 缓存，避免重复联网下载；下载/解包代码路径由运行时测试独立覆盖。UI 验证在真实 Moss EmbeddedAppView、preload、安装器与 runtime 中进行，使用隔离用户数据并在结束后清理，不操作用户仓库内容。

## 随包依赖与 CI 更新

六个本地 App 的最新包大小、断网验证、重建与市场登记结果见 [CI 交付记录](local-apps-ci-delivery.md)。旧 UI 报告记录交互覆盖；当前 ZIP 的依赖完整性以带 `archiveSha256` 的断网报告为准。UI 验证脚本已移除引擎缓存预填充。
