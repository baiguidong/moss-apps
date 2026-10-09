# MCP

独立的 Moss MCP 管理 App。内置 Playwright CDP 浏览器服务，使用紧凑工具栏与分栏工作区。左侧搜索和筛选服务，右侧查看工具、连接信息和授权状态。支持本地进程（stdio）、Streamable HTTP、SSE，提供连接检查、工具目录、服务启停及浏览器 OAuth 授权。

需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.0.0）。App 通过现有 SDK 的通用 Host transport 调用该协议，无需复制 SDK 或 MCP 客户端。安装时授予 MCP 读取、管理、连接及授权权限。

## 内置 Playwright CDP

安装并授权后，App 后端启动时自动注册并启用 `playwright-cdp`，无需先打开管理界面。Playwright MCP `0.0.83` 及其生产依赖随安装包提供，由 Moss 的 Node 运行时直接启动。使用时无需 `npx`、npm 缓存、另外安装 Node.js 或联网下载依赖。默认启动参数：

```text
--cdp-endpoint
http://127.0.0.1:9222
--output-dir
~/.moss/artifacts/playwright
```

启动 MCP 进程时会检查本机 CDP 地址：已有可用浏览器就复用，否则自动寻找系统 Chrome，以独立用户目录启动并开启远程调试。正常使用不需要手动运行 Chrome 命令；首次打开已启用服务时会自动加载工具目录，并触发启动；也可点击“检查连接”重试。App 不附带 Chrome，若系统未安装、指定路径无效或端口被其他服务占用，会在界面显示原因，提供重试和修改配置入口。

默认用户目录是 `~/.moss/browser-profiles/playwright-cdp-9222`（端口变化时使用对应目录），保存登录状态。普通 Chrome 的日常用户目录不受影响。多个 MCP 会话共用同一端口的浏览器；停止 MCP 不会关闭 Chrome，避免影响其他会话。浏览器被手动关闭后，下次启动 MCP 时会重新开启。

可使用标准启动参数 `--executable-path` 指定 Chrome 可执行文件、`--user-data-dir` 指定专用目录，`--headless` 用于无窗口环境。自动启动仅适用于 `http://127.0.0.1:<端口>` 和 `http://localhost:<端口>`；远程、HTTPS、WebSocket、带代理路径或认证的 CDP 地址继续由用户提供，不会在本机启动替代浏览器。

已有 `npx -y @playwright/mcp@0.0.83` 预设会迁移为内置启动器，保留其 CDP 地址、输出目录、凭据、工具选项及启停状态；其他自定义启动器或自选包版本保持原样。升级或换电脑时，内置启动器路径会自动定位到当前 App 和运行时。内置服务可编辑、停用，名称固定且不能删除。注册失败不影响其他连接管理，读取列表时可重试。对于默认本机 CDP，工具目录检查会先确认浏览器已启动；远程 CDP 的实际连通性仍需浏览器操作验证。

启动命令与参数中的 `~`、`~/`、`~\`，以及 `--output-dir=~/...`，会在执行前展开为当前用户目录；磁盘配置和界面仍保留原写法，适配 macOS、Linux、Windows。内置 Playwright 启动器自带展开能力，在旧版兼容 Host 上也可使用；其他 stdio 服务使用该写法需更新本次配套修改的 Desktop Host。每行一个参数，无需给含空格的路径加引号；不执行 shell 语法或展开 `$HOME`。已有绝对路径不会被自动改写，可在编辑连接时改成 `~/...`。

## 开发与验证

在仓库根目录运行：

```sh
bun install
bun run --cwd apps/mcp dev
bun run --cwd apps/mcp check
bun run --cwd apps/mcp test
bun run --cwd apps/mcp test:browser
node scripts/package-app.mjs --app moss.mcp
```

普通浏览器提供明确标识的演示数据；演示操作不连接服务、不保存真实配置。真实操作通过已安装的 App Backend 和 Host API 执行。

真实运行链路验证使用临时 Moss 数据目录、打包后的 App、Core 的实际进程管理及 MCP 客户端，并启动本地 HTTP、SSE 和 stdio 测试服务：

```sh
# 在 Moss 主仓库先构建本地运行时
bun run --cwd ../moss/ui build:direct
MOSS_CORE_ROOT=/path/to/moss node apps/mcp/scripts/verify-host.mjs
# 冷启动验证：从关闭的端口自动启动 Chrome，检查并发复用和重启（需要系统 Chrome）
node apps/mcp/scripts/verify-browser-startup.mjs
# 可选：使用已开启 CDP 的 Chrome，禁止外部网络、清空 PATH 和 npm 缓存进行离线验证
MOSS_TEST_CDP_ENDPOINT=http://127.0.0.1:9222 node apps/mcp/scripts/verify-host.mjs
```

构建时从锁定的依赖复制完整生产包、运行时资源及许可证到 `dist/playwright-cdp/`，不打包浏览器二进制；依赖版本记录在 `versions.json`。

结果写入 `artifacts/moss.mcp/verification/<version>/host.json`；页面截图位于 `artifacts/moss.mcp/screenshots/<version>/`。第三方 OAuth 账号授权沿用 Core 授权流程，需在目标服务上完成实际授权。

## 配置与迁移

- 安装并授权后，Host 自动迁移原桌面设置中的 MCP 服务，保留服务名称、启用状态、OAuth 选项及排除的工具。
- 新配置位于 App 私有目录；环境变量和请求头的值存入 App Credential Vault。界面仅返回字段名称；编辑时空值保留已存值，删除字段则移除对应值。
- 新存储和密钥写入成功后才清除旧设置。迁移失败保留原数据；安装前仍可使用原有服务。
- OAuth token 继续由 Core 原有授权存储管理，服务名称保持不变，因此已有授权可继续使用。
- App 总开关、权限和服务开关共同决定工具是否注入本地会话。进行中的会话在结束后重新加载，空闲会话在下次发送前重新加载。云端会话的 MCP 配置仍由服务端管理。
- 界面的“检查通过”表示最近一次检查结果，附带检查时间，不代表持续健康监控。每个服务最多展示 200 个工具，目录还有整体响应大小限制；对话中的工具发现仍使用完整的原生 MCP 链路。

## 发布

新版本从 `0.1.0` 开始，独立打包发布；不随 Moss 安装包预装。公开发布遵循仓库根目录的签名与版本规范。

首次启用、编辑连接后，当前服务的工具目录会自动更新；加载期间可以切换配置页或停用服务，过期结果不会覆盖最新状态。配套更新的 Moss Desktop 会在“设置 → 工具 → App 提供的工具”中展示动态 MCP 工具；该设置页修复需要同时更新 Desktop。
