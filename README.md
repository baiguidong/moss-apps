# Moss Apps

Moss 官方 App 的独立源码与发布仓库。每个 App 位于 `apps/<name>`，独立维护版本、源码、配置 Schema、资源与测试。

当前应用：[网盘](apps/drive/README.md)、[飞书](apps/feishu/README.md)、[OpenIM](apps/openim/README.md)。

## App 创建手册

创建或修改 App 前，请阅读 Moss 主仓库维护的说明。只检出本仓库时，也可以直接通过以下 GitHub 链接查看：

- [App 创建规范](https://github.com/baiguidong/moss/blob/main/assistants/app-builder/assistant.md)：创建流程、UI 与主题规范、Backend 生命周期、Host API 使用及自检要求。
- [App Runtime](https://github.com/baiguidong/moss/blob/main/ui/docs/app-runtime.md)：Manifest、安装包结构、配置与密钥、单进程运行约定。
- [Host Capability API](https://github.com/baiguidong/moss/blob/main/ui/docs/app-host-capability-api.md)：Host 协议、权限声明与 Backend 调用方式。

创建规范中的 `app_*` 工具用于 Moss 内置构建助手；在本仓库直接开发时，使用下文的本地开发和发布命令。

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

App 版本来自其 `app.moss.json`。发布标签格式为：

```text
<app-id>-v<semver>
```

例如：

```bash
git tag moss.feishu-v0.2.1
git push origin moss.feishu-v0.2.1
```

`release-app.yml` 会校验、测试、构建并签名 App，将不可变 ZIP 上传到 GitHub Releases，然后把市场索引部署到 GitHub Pages：

- `https://baiguidong.github.io/moss-apps/v1/index.json`
- `https://baiguidong.github.io/moss-apps/v1/apps/<app-id>.json`

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

发布 ZIP 根目录直接包含 `app.moss.json`，不额外嵌套目录。源码、测试、开发依赖和私钥不会进入 ZIP。Backend 应优先编译为独立 JavaScript；无法内联的原生模块及其运行时依赖可以放在 `dist/backend/node_modules`，但不得复制完整开发依赖树。

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
- 修改 App 运行内容时必须提升 `app.moss.json` 版本。
- Moss 不固定 App 版本；安装和升级版本由用户在应用市场中选择。

## SDK

SDK 源码只在 Moss Core 的 `packages/app-sdk` 维护。本仓库通过 Git 子模块 `vendor/moss-core` 固定引用 Core 提交，将其中的 SDK 纳入 Bun workspace；App 和构建脚本统一通过 `@moss/app-sdk` 包导入，不再保存 SDK 副本。

当前引用的 SDK 为 `2.2.0`，包含 `moss.cloud-storage/v1`；通用文件、截图和外链使用 `moss.platform/v1`。接入方式见 [SDK 接入说明](docs/app-sdk.md)。SDK 会忽略 Manifest 的未知字段；本仓库的构建与发布校验仍会在规范化前拒绝 `backend.targets`、`backend.serverOwnerScope` 和 `moss.remote/v1` 声明。

初次检出使用 `git clone --recurse-submodules`，已有检出按上方命令初始化子模块。CI、App 发布和市场索引工作流都会检出相同的固定提交。

升级 SDK 时，在 Core 提交修改并推送到远端后更新 `vendor/moss-core` 指向的提交并运行 `bun install`，然后执行本仓库的校验、类型检查、测试和构建。提交子模块引用与锁文件即可，不复制或单独修改 SDK 源码。未推送的 Core 提交只能在持有该提交的本地仓库中验证，CI 无法检出。

SDK 会编入 App Backend；构建内容变化时应同步提升相应 App 的版本。未来发布 npm 包后，可以改为包版本依赖，App 的 import 无需改变。
