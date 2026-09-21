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
git tag moss.feishu-v0.2.0
git push origin moss.feishu-v0.2.0
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

发布 ZIP 根目录直接包含 `app.moss.json`，不额外嵌套目录。源码、测试、`node_modules` 和私钥不会进入 ZIP。

## Moss 预装

Moss 的发布 CI 不重新编译本仓库源码，也不使用市场里的浮动 `latest`。主仓库在
`config/bundled-apps.lock.json` 中锁定 App 版本、Release 下载地址、SHA-256 和签名密钥，
构建时下载并验证 ZIP，再把验证通过的内容放入桌面安装包。升级预装版本必须显式更新锁文件。

App ZIP 与 Moss 桌面安装包分开：Moss 仍分别构建 macOS arm64 和 Windows x64 安装包；
当前飞书 App 是纯 JavaScript，同一个签名 ZIP 可同时用于这两个平台，支持范围由
`apps/feishu/marketplace.json` 的 `platforms` 声明。以后包含原生依赖的 App 可以按平台发布独立产物。

## 版本规则

- App 使用独立 SemVer。
- 已发布的 `<app-id>@<version>` 不允许覆盖。
- 修改 App 运行内容时必须提升 `app.moss.json` 版本。
- Moss 预装版本由 Moss 主仓库的 `bundled-apps.lock.json` 固定，不跟随市场 `latest` 自动漂移。

## SDK

`packages/app-sdk` 是当前 Host API `1.2.0` 的发布快照，供本仓库 App 构建和测试。后续可迁移为正式发布的 `@moss/app-sdk` npm 包而不改变 App 代码。
