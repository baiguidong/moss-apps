# MCP 管理

独立的 Moss MCP 管理 App，集中管理用户添加的服务。支持本地进程（stdio）、Streamable HTTP 和 SSE，提供连接检查、工具目录、服务启停、浏览器 OAuth 授权及加密凭据。

需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.4.0）。通过 App SDK 调用现有 Host 协议，复用 Core MCP 客户端。安装时授予 MCP 读取、管理、连接及授权权限。

Playwright 浏览器控制已抽为独立的「网页操控 · Browser Use」App。此 App 不再自动注册或打包浏览器服务；已有服务记录按普通服务管理，不做浏览器配置迁移、删除或重写。

## 使用

添加服务，填写启动命令或远程地址，保存后自动检查当前已启用服务的工具目录。敏感值保存在 App Credential Vault，列表仅返回字段名称；编辑时空值保留已有密钥，删除字段则移除对应值。

命令和参数支持 `~`、`~/`、`~\\` 及 `--output-dir=~/...`。每行一个参数，含空格的路径无需加引号，不执行 shell 语法。旧桌面通用 MCP 设置继续由现有 Host 流程接入，服务名称与授权存储沿用现有规则。

App、实例和服务开关共同决定工具是否进入本地会话；忙碌会话结束后重新加载，空闲会话刷新后生效。页面展示最近一次检查结果，并非持续健康监控。工具目录最多展示 200 项，实际对话沿用完整原生 MCP 发现和调用。

## 开发与验证

```sh
bun install
bun run --cwd apps/mcp check
bun run --cwd apps/mcp test
bun run --cwd apps/mcp test:browser
node scripts/package-app.mjs --app moss.mcp
MOSS_CORE_ROOT=/path/to/moss node apps/mcp/scripts/verify-host.mjs
```

真实 Host 验证在临时数据目录安装 App，通过本地 HTTP、SSE 和 stdio 测试服务检查注册、凭据、工具目录及启停。需先在 Moss 仓库构建 `ui/electron-direct.mjs`。页面开发模式使用明确标识的演示数据，不连接真实服务。

## 会话工具范围

本 App 使用 Host API 3.8 的通用 `toolSelection: "services"`：在 `@` 或“选择资源 → App”打开 MCP 管理后，可分别选择具体服务，也可通过搜索直接添加。只有已选服务常驻，全选只保存当前服务集合；后续新增不会自动选中。服务改名保留选择，删除重建不复用旧选择。所有服务仍继承 App 根级 `toolScope`（默认 session）；global 保持按需发现，只对已选服务常驻。权限、启停与 Backend 生命周期沿用 App 规则。需要 Desktop Host API >=3.8.0，单独更新 App 无法让旧 Desktop 支持两层选择。

本版本要求 Moss Host API >=3.4.0，展示入口为设置 → 连接与集成 → MCP 管理。位置由 Manifest 声明；旧安装需要更新后生效。
