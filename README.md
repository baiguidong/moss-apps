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

发布 ZIP 根目录直接包含 `app.moss.json`，不额外嵌套目录。源码、测试、`node_modules` 和私钥不会进入 ZIP。

## Moss 预装

Moss 的发布 CI 不重新编译本仓库源码，也不使用市场里的浮动 `latest`。主仓库的
`config/bundled-apps.lock.json` 只锁定 App ID 和一个固定版本；构建时从本仓库发布的
Marketplace 索引解析 Release 下载地址、SHA-256 和签名信息，验证 ZIP 后放入桌面安装包。
升级预装版本必须显式更新锁文件。

App ZIP 与 Moss 桌面安装包分开：Moss 仍分别构建 macOS arm64 和 Windows x64 安装包；
当前飞书 App 是纯 JavaScript，同一个签名 ZIP 可同时用于这两个平台，支持范围由
`apps/feishu/marketplace.json` 的 `platforms` 声明。以后包含原生依赖的 App 可以按平台发布独立产物。

## 版本规则

- App 使用独立 SemVer。
- 已发布的 `<app-id>@<version>` 不允许覆盖。
- 修改 App 运行内容时必须提升 `app.moss.json` 版本。
- Moss 预装版本由 Moss 主仓库的 `bundled-apps.lock.json` 固定，不跟随市场 `latest` 自动漂移。

## SDK

`packages/app-sdk` 是当前 Host API `2.0.0` 的发布快照，供本仓库 App 构建和测试。2.0 不提供旧 Channel 或平台专用协议兼容层；后续可迁移为正式发布的 `@moss/app-sdk` npm 包而不改变 App 代码。
