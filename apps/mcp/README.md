# MCP 管理

独立的 Moss MCP 管理 App，集中管理用户添加的服务。支持本地进程（stdio）、Streamable HTTP 和 SSE，提供连接检查、工具目录、服务启停、浏览器 OAuth 授权及加密凭据。

需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.22.0）。通过 App SDK 调用现有 Host 协议，复用 Core MCP 客户端。安装时授予 MCP 读取、管理、连接及授权权限。

`0.1.14` 同步共享 SDK：安装、更新与 Host 启动加载时检查版本范围，运行时不再校验 Host 返回值的固定结构。参数、身份、权限与取消检查保留。配套 Host 保持旧版 MCP 检查结果的公开字段，内部 `schemaRevision`、`catalogStale` 仅用于桌面工具目录，旧 App 无需更新即可恢复列表读取；新 App 仍可接收 Host 的扩展响应。

Playwright 浏览器控制已抽为独立的「网页操控 · Browser Use」App。此 App 不再自动注册或打包浏览器服务；已有服务记录按普通服务管理，不做浏览器配置迁移、删除或重写。

## 使用

在「插件 → MCP 管理 → 管理服务」添加服务，填写启动命令或远程地址。保存只更新连接配置；主动检查或实际使用时才连接。敏感值保存在 App Credential Vault，列表仅返回字段名称；编辑时空值保留已有密钥，删除字段则移除对应值。

命令和参数支持 `~`、`~/`、`~\\` 及 `--output-dir=~/...`。每行一个参数，含空格的路径无需加引号，不执行 shell 语法。旧桌面通用 MCP 设置继续由现有 Host 流程接入，服务名称与授权存储沿用现有规则。

App、实例和服务开关共同决定工具是否进入本地会话；忙碌会话结束后重新加载，空闲会话刷新后生效。页面展示最近一次检查结果，并非持续健康监控。工具目录统一在 Core 详情页展示当前版本的缓存，实际对话沿用完整原生 MCP 发现和调用。

### DBX 原版 MCP

本地进程使用 `npx`，参数每行填写 `-y`、`@dbx-app/mcp-server@0.4.127`、`--stdio`。独立的 DBX MCP App 使用随包启动器；两者都支持在「编辑连接 → 环境变量」配置同一组上游参数：

- `DBX_DATA_DIR`：DBX 数据目录的绝对路径。
- `DBX_SECRET_KEY_FILE`：该目录对应的既有密钥文件绝对路径；密钥值不要填写在参数中。
- `DBX_MCP_ALLOW_WRITES=0`：强制只读，也会禁止添加、删除连接。需要首次创建连接时，不要开启此限制；配置完成后可再启用。`1` 不会绕过 DBX 已保存的只读策略。

`KEY_PROVIDER_UNAVAILABLE` 不是 MCP 传输失败。独立原版服务只读取密钥，不自动初始化系统钥匙串；没有 DBX Desktop 的新用户需要初始化一个独立的空数据目录和私有密钥文件，再传入上述两个路径。已有加密数据必须恢复原密钥，不能生成新密钥覆盖。MCP 检查发现工具成功不代表保存凭据或数据库连通性已验证。

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

本版本要求 Moss Host API >=3.22.0 且 <4.0.0，展示入口为插件 → MCP 管理 → 管理服务。位置由 Manifest 声明；旧安装需要更新后生效。
