# Moss Apps

Moss 官方 App 的独立源码与发布仓库。每个 App 位于 `apps/<name>`，独立维护版本、源码、配置 Schema、资源与测试。

## 本地开发

```bash
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

### Backend 运行位置

每个带 Backend 的 App 都必须在 `app.moss.json` 中按实际能力显式声明 `backend.targets`：

| 声明 | 含义 |
| --- | --- |
| `["desktop"]` | 只能随 Moss Desktop 运行；客户端退出或设备关机后 Backend 不再工作 |
| `["server"]` | 只能部署到 Moss Server；可以由 Server 7×24 运行 |
| `["desktop", "server"]` | 同一个 Backend 支持两种候选位置；每个 instance 同一时刻只在其中一处运行 |

声明 `server` 是运行能力承诺，不是预留开关，而且不是所有 App 都需要支持。大多数 App 应保持 `["desktop"]`；只有声明 `server` 的 App 才能由 Moss Server 7×24 运行。Desktop 与 Server 模式可以采用不同逻辑并提供不同的适用功能，但各模式必须独立运行，不能依赖另一端的 Backend 同时在线。声明两种 target 不会创建两个协作进程；迁移到 Server 时先停止 Desktop deployment，再由 Server 接管同一个逻辑 instance。

`backend.protocols` 按 target 声明，例如 `{"desktop": ["moss.desktop/v1"], "server": ["moss.agent/v1"]}`。只声明当前模式真正调用的协议，Desktop 专属协议不得放入 `server`。旧数组格式仅为现有 App 迁移保留，并视为所有 target 共用同一组协议；新 App 不应使用。

UI 与 Backend 位置相互独立。App 可以只有 Desktop UI 而 Backend 只运行在 Server；UI 调用逻辑 instance，由 Moss Host 定位 active deployment，不应自行连接 Server。`moss.remote/v1` 是现有 App 的过渡兼容协议，新 App 不得用它把一个 Backend 拆成 Desktop/Server 两个协作角色。

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

`packages/app-sdk` 是当前 Host API `2.0.0` 的发布快照，供本仓库 App 构建和测试。2.0 不提供旧 Channel 或平台专用协议兼容层；后续可迁移为正式发布的 `@moss/app-sdk` npm 包而不改变 App 代码。
