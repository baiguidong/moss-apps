# Moss Apps

Moss 官方 App 的独立源码与发布仓库。普通 App 位于 `apps/<name>`；配置型 MCP App 位于 `mcp-apps/<name>`，只维护定义和资源，由 Moss Core 提供公共 UI 与运行能力。两者共用自动发布与应用市场。

App 按主要用途分组：

| 分类 | App |
| --- | --- |
| 沟通协作 `communication` | [飞书](apps/feishu/README.md)、[即时消息](apps/openim/README.md) |
| 知识与文件 `knowledge` | [知识库](apps/library/README.md)、[网盘](apps/drive/README.md)、[文件系统](mcp-apps/filesystem/README.md)、[图片工具](apps/image-tools/README.md)、[PDF 工作台](apps/pdf-tools/README.md)、[语音转写](apps/transcription/README.md)、[文件清理](apps/file-cleaner/README.md)、[文档格式转换](apps/document-converter/README.md) |
| 自动化 `automation` | [工作流](apps/workflow/README.md)、[网页操控](apps/browser-use/README.md)、[电脑操控](apps/computer-use/README.md) |
| AI 增强 `ai` | [记忆](apps/memory/README.md)、[分步思考](mcp-apps/sequential-thinking/README.md)、[MCP 管理](apps/mcp/README.md) |
| 开发工具 `development` | [应用构建](apps/app-builder/README.md)、[开发工具](apps/devtools/README.md)、[Git 仓库](mcp-apps/git/README.md)、[代码地图](apps/code-map/README.md) |
| 诊断与审计 `diagnostics` | [调用追踪](apps/trace/README.md)、[审计中心](apps/audit/README.md) |

规划中的本地工具扩展见 [本地工具 App 选型与接入方案](docs/local-tool-apps-plan.md)，覆盖开发工具、HTTP 调试、图片和音视频处理。

图片工具、PDF 工作台和语音转写采用自有 UI 与本地 Backend，首批交付范围、安装包和实际 Moss 页面验证见 [本地任务 App 交付记录](docs/local-task-apps-delivery.md)。

文件清理、文档格式转换和代码地图使用开源 CLI / MCP 引擎、自有 UI 与薄适配层，支持传统页面操作和 Agent 共享结果，见 [CLI / MCP 引擎 App 交付记录](docs/engine-apps-delivery.md)。

六个本地 App 的依赖、转写模型均进入最终发布 ZIP；打包、断网验证和市场登记状态见 [随包依赖与 CI 交付](docs/local-apps-ci-delivery.md)。

六个 App 的 [0.1.1 初始发布入口](docs/initial-local-apps-release.md)。

`0.1.1` 的鼠标裁剪、图片处理扩展、紧凑布局与 MCP 动态工具数量修复见 [App 界面更新](docs/app-ui-refinement.md)。

## App 创建手册

创建或修改 App 前，请阅读 Moss 主仓库维护的说明。只检出本仓库时，也可以直接通过以下 GitHub 链接查看：

- [App 创建规范](https://github.com/baiguidong/moss/blob/main/ui/docs/app-authoring.md)：创建流程、UI 与主题规范、Backend 生命周期、Host API 使用及自检要求。
- [App Runtime](https://github.com/baiguidong/moss/blob/main/ui/docs/app-runtime.md)：Manifest、安装包结构、配置与密钥、单进程运行约定。
- [Host Capability API](https://github.com/baiguidong/moss/blob/main/ui/docs/app-host-capability-api.md)：Host 协议、权限声明与 Backend 调用方式。

[应用构建 App](apps/app-builder/README.md) 提供普通会话内的创建和编辑工具；在本仓库直接开发时，使用下文的本地开发和发布命令。App 工具范围在 Manifest 根级声明 `toolScope`，默认 `session`，所有原生和 MCP 工具继承。显式使用该字段要求 Host API >=3.1.0。

## 本地开发

```bash
git submodule update --init --depth 1 vendor/moss-core
bun install
bun run validate
bun run check
bun run test
bun run build
```

只操作一个 App：

```bash
node scripts/run-apps.mjs build --app moss.feishu
node scripts/package-app.mjs --app moss.feishu
```

产物位于：

```text
artifacts/<app-id>/<version>/<app-id>-<version>.zip
artifacts/<app-id>/<version>/<app-id>-<version>.sha256
artifacts/<app-id>/<version>/<app-id>-<version>.release.json
```

## 发布

`Release Changed Apps` 在 main 提交、每 6 小时检查或手动运行时，比较两个目录的版本与全部已发布 GitHub Releases。新 App / 更高版本自动校验、测试、构建、签名并发布；同版本跳过，落后版本提示，不自动提升版本。

普通 App 的版本来自 `app.moss.json`（同步 package.json）；配置型 App 来自 `app.json`。发布标签仍为 `<app-id>-v<semver>`，由 CI 绑定被检查的提交自动创建。每个 App 独立执行，最后统一刷新一次市场。中断的草稿可重试，正式版本不可覆盖。

本地运行 `bun run release:plan` 只生成发布计划；Actions 手动运行默认 `dry_run=true`。完整规则、失败恢复及 Core 子模块上线前提见 [统一 App 自动发布](docs/automatic-app-release.md)。市场地址：

- `https://baiguidong.github.io/moss-apps/v1/index.json`
- `https://baiguidong.github.io/moss-apps/v1/apps/<app-id>.json`

后续所有新发布版本必须在同一个 ZIP 内携带与运行产物对应的完整、可重建源码，包括构建脚本、依赖锁文件、必要的 workspace 文件和固定版本 SDK。缺源码、只有编译产物或依赖本机仓库才能构建的包，不符合发布要求。具体规则、包结构、CI 门禁和 Core 接入说明见 [App 源码随包发布规范](docs/app-source-packaging.md)。

App Builder 创建或修改的 App，每次本机安装也必须在该安装版本目录内携带完整源码，采用相同的 `source/` 与 `source-manifest.json` 格式；不以发布市场或导出 ZIP 为前提。源码不能只保存在原会话工作区、构建缓存或临时快照中，删除这些目录、重启或换会话后，仍须能从已安装版本恢复工程继续迭代。本地版本按本地构建记录和 checksums 校验，不冒用市场发布者签名。

打包器已强制从导出的源码快照锁定安装、检查、测试和构建，并验证最终 ZIP 与独立 Backend 握手。`--skip-build` 也会重新构建，不再复用未绑定源码的 dist。CI 和正式发布运行 `node scripts/verify-source-package.mjs --rebuild`；签名发布要求已提交的 App 源码和干净、固定的 Core 子模块。

发布前必须配置仓库 Actions Secret：`MOSS_APP_SIGNING_PRIVATE_KEY`。公钥保存在 `publishers/<publisher-id>/<key-id>.pem`，Moss 客户端固定信任该公钥。

首次生成密钥：

```bash
bun run keys:generate
gh secret set MOSS_APP_SIGNING_PRIVATE_KEY < .secrets/moss-release-private.pem
```

私钥只保存在 `.secrets/` 和 GitHub Actions Secret 中，禁止提交。

## App 目录约定

每个 App 至少包含：

```text
apps/example/
├── app.moss.json
├── marketplace.json
├── package.json
├── README.md
├── assets/
├── schemas/
├── src/
└── scripts/
```

`marketplace.json` 只保存展示信息。版本、权限、Host API、下载地址和校验值由 CI 从 Manifest 与构建产物生成。

### 分类与搜索

每个 App 的 `app.moss.json` 必须显式设置一个 `category`，使用上表的固定英文标识；仅在确实不适合现有分类时使用 `other`。通过 `keywords` 声明相关别名和搜索词（最多 20 项，每项 1–40 字符）。例如：

```json
{
  "category": "automation",
  "keywords": ["浏览器", "Chrome", "Playwright"]
}
```

`marketplace.json` 不再重复填写 `categories` 或 `keywords`。构建脚本从 Manifest 生成市场的 `category` 和 `keywords`，同时生成中文 `categories` 数组兼容旧客户端；残留的重复字段必须与 Manifest 一致，否则校验失败。市场索引使用仓库当前分类，可为旧发布记录补充展示分类；安装后使用包内 Manifest，旧包缺分类时显示“其他”。不得修改历史签名包，应在发布新版本时携带新分类。

分类定义来自固定 Core SDK 的 Manifest Schema。变更 Schema 后先更新 SDK；本地联合开发可使用现有 `apps/app-builder/scripts/sync-core-sdk.mjs` 同步并记录快照，正式发布仍须固定已推送的 Core 提交。`bun run validate` 会校验全部 App 分类，打包时保留分类与关键词。创建、编辑、源码恢复与自检规则见 [App 创建规范：分类与搜索](https://github.com/baiguidong/moss/blob/main/ui/docs/app-authoring.md#分类与搜索)。

### 导航入口

已启用且有 UI 的 App 自动进入 Moss“更多”，每个 App 一个入口。停用后入口隐藏，纯后台 App 只在 Apps 中管理，无需手动加入侧栏。

App 声明页面名称和路由，导航位置由 Moss 决定，不再声明 `contributes.views[].location`。Moss 使用已授权 view 中 `order` 最小的页面作为默认入口；未声明 view 时打开 `ui.entry`。其他页面由 App 内部导航，旧包的位置字段会被忽略。

### Backend 运行位置

每个 App 最多运行一个由 Host 管理的 Backend 进程，Manifest 无需声明实例模式。配置、启停、重启和日志均围绕 App 管理。

本仓库的 App Backend 只随 Moss Desktop 运行，不支持部署到 Moss Server。运行位置是隐式约定，App 不声明 `targets`。带 Backend 的 App 直接声明所需 Host 协议：

```json
{
  "backend": {
    "protocols": ["moss.agent/v1"]
  }
}
```

`backend.protocols` 必须是协议名称数组。Moss Desktop 退出或设备关机后，App Backend 不再运行。App 可以通过 Host API 使用由 Moss Server 提供的账号、Agent 或业务能力，但 App Backend 本身仍运行在 Desktop；App 不得声明 `targets`、`serverOwnerScope` 或 `moss.remote/v1`。

发布 ZIP 根目录直接包含 `app.moss.json`，不额外嵌套整个 App 目录。运行产物位于 `dist/` 等原有目录；可重建工程统一放入 `source/`，由根目录 `source-manifest.json` 记录入口、版本、构建环境与摘要，具体格式见 [源码发布规范](docs/app-source-packaging.md)。源码、测试、构建配置和开发依赖的声明及锁文件必须随包；完整 `node_modules`、缓存、凭据、私钥和用户实例数据不得进入源码目录。

Backend 应优先编译为独立 JavaScript；无法内联的原生模块及其运行时依赖可以放在 `dist/backend/node_modules`，但不得复制完整开发依赖树。运行产物必须自行包含所需 SDK 和其他运行依赖，不得依赖包内 `source/`、开发工作区或全局安装的模块才能启动。

## Moss 安装

Moss 的发布 CI 不下载、锁定或预装本仓库中的 App。App 由本仓库独立构建并发布到
Marketplace；用户在 Moss 应用市场中选择版本，客户端下载对应的签名 ZIP 并完成校验后安装。
Moss 自身升级不会安装、替换或升级 App。

App ZIP 与 Moss 桌面安装包分开。纯 JavaScript App 可以用同一个签名 ZIP 支持多个平台；
包含原生依赖的 App 也可以在一个 ZIP 中携带其声明支持的多套运行文件。应用市场根据
`marketplace.json` 的 `platforms` 自动过滤不支持当前设备的版本，构建脚本不得把未声明平台的原生文件带入发布包。

## 版本规则

- App 使用独立 SemVer。
- 已发布的 `<app-id>@<version>` 不允许覆盖。
- 修改已发布 ZIP 的任何内容，包括运行产物、源码、锁文件和构建元数据，都必须提升 `app.moss.json` 版本；给旧包补源码也必须发布新版本。
- Moss 不固定 App 版本；安装和升级版本由用户在应用市场中选择。

## SDK

SDK 源码只在 Moss Core 的 `packages/app-sdk` 维护。本仓库通过 Git 子模块 `vendor/moss-core` 固定引用 Core 提交，将其中的 SDK 纳入 Bun workspace；App 和构建脚本统一通过 `@moss/app-sdk` 包导入，不手工维护另一套 SDK。发布时由打包流程从固定提交自动导出所需 SDK、host-contracts 及本地构建依赖到源码快照，供该版本独立重建；这份不可变发布快照不是新的 SDK 维护分支。

当前开发快照包含 Host API 3.9；各 App 按自身功能声明最低 Host 版本，配置型 MCP App 要求 `^3.9.0`。正式发布须将已推送的 Core 提交固定到子模块；Tasks/Execution 与 MCP 的契约由同一 Core 提交中的 `packages/host-contracts` 提供。UI 使用 `@moss/app-sdk/ui` 自动绑定当前 App，普通调用不传实例 ID。通用文件、截图和外链使用 `moss.platform/v1`，审计中心使用 `moss.audit/v1`。接入方式见 [SDK 接入说明](docs/app-sdk.md)。SDK 会忽略 Manifest 的未知字段；本仓库的构建与发布校验仍会在规范化前拒绝 `backend.targets`、`backend.serverOwnerScope` 和 `moss.remote/v1` 声明。

初次检出使用 `git clone --recurse-submodules`，已有检出按上方命令初始化子模块。CI、App 发布和市场索引工作流都会检出相同的固定提交。

若本地对子模块启用了稀疏检出，需包含 `packages/host-contracts`：`git -C vendor/moss-core sparse-checkout add packages/host-contracts`。

升级 SDK 时，在 Core 提交修改并推送到远端后更新 `vendor/moss-core` 指向的提交并运行 `bun install`，然后执行本仓库的校验、类型检查、测试和构建。提交子模块引用与锁文件即可，不复制或单独修改 SDK 源码。未推送的 Core 提交只能在持有该提交的本地仓库中验证，CI 无法检出。

SDK 会编入 App Backend；构建内容变化时应同步提升相应 App 的版本。未来发布 npm 包后，可以改为包版本依赖，App 的 import 无需改变。

应用市场支持通过 `build-catalog.mjs --mirror-apps moss.library` 在目录同域托管指定 App 的签名 ZIP。构建目录时会验证原始 release 的大小与 SHA-256，只改分发地址，签名包和不可变 GitHub Release 保持原样。发布及手动目录部署使用同一配置；目前为知识库启用，以减少 GitHub 下载链路超时。

## App 展示位置

当前版本在 `app.moss.json` 根级声明 `navigation`，要求 Host API >=3.4.0。操作页使用 `more`，配置页使用 `settings` 并在 `contributes.settings` 中声明分组，纯后台使用 `none`。新建 App 必须按用途选择，仓库校验拒绝缺失声明；编辑与源码恢复保留原位置。飞书、电脑操控和分步思考均进入“设置 → Apps”；分步思考保留 `toolScope: "global"`，设置页提供状态与重连操作。具体契约与示例见 [Core 创建规则](https://github.com/baiguidong/moss/blob/main/ui/docs/app-authoring.md)。
