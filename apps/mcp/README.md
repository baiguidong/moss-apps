# MCP

独立的 Moss MCP 管理 App。左侧搜索和筛选服务，右侧查看工具、连接信息和授权状态。支持本地进程（stdio）、Streamable HTTP、SSE，提供连接检查、工具目录、服务启停及浏览器 OAuth 授权。

需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API 2.4.0 或更新的兼容版本）。App 通过现有 SDK 的通用 Host transport 调用该协议，无需复制 SDK 或 MCP 客户端。安装时授予 MCP 读取、管理、连接及授权权限。

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
```

结果写入 `artifacts/moss.mcp/verification/0.1.0/host.json`；页面截图位于 `artifacts/moss.mcp/screenshots/0.1.0/`。第三方 OAuth 账号授权沿用 Core 授权流程，需在目标服务上完成实际授权。

## 配置与迁移

- 安装并授权后，Host 自动迁移原桌面设置中的 MCP 服务，保留服务名称、启用状态、OAuth 选项及排除的工具。
- 新配置位于 App 私有目录；环境变量和请求头的值存入 App Credential Vault。界面仅返回字段名称；编辑时空值保留已存值，删除字段则移除对应值。
- 新存储和密钥写入成功后才清除旧设置。迁移失败保留原数据；安装前仍可使用原有服务。
- OAuth token 继续由 Core 原有授权存储管理，服务名称保持不变，因此已有授权可继续使用。
- App 总开关、权限和服务开关共同决定工具是否注入本地会话。进行中的会话在结束后重新加载，空闲会话在下次发送前重新加载。云端会话的 MCP 配置仍由服务端管理。
- 界面的“检查通过”表示最近一次检查结果，附带检查时间，不代表持续健康监控。每个服务最多展示 200 个工具，目录还有整体响应大小限制；对话中的工具发现仍使用完整的原生 MCP 链路。

## 发布

新版本从 `0.1.0` 开始，独立打包发布；不随 Moss 安装包预装。公开发布遵循仓库根目录的签名与版本规范。
