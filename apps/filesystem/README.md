# 文件系统 · Filesystem

独立的 Moss 文件系统 App，沿用网页操控、记忆的接入模式。在设置 → 工具中管理公共目录、服务检查及排除工具；启用后后台自动注册自己的 MCP 服务，无需安装 MCP 管理 App。

会话 workspace 自动追加到当前 MCP 连接并优先使用，相对路径默认在此解析。公共目录可留空，也可每行添加一个已有目录，支持绝对路径和 `~/`，最多 32 个。工具可访问 workspace、公共目录及其子目录。清空公共列表后仍可使用会话目录，不删除文件；设置跨 App 重启和更新保留。关闭页面不停止后台。

固定提供上游的 14 项工具（包括兼容旧客户端的 `read_file`），支持文本和媒体读取、批量读取、写入、修改预览、目录列表、搜索、文件移动与元信息查询。修改设置后，忙碌对话在本轮结束后更新工具和目录范围。

## 接入与范围

需要支持 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.4.0），授予 MCP 读取、管理和连接权限。App 只接受目录和排除工具设置，不开放自定义命令或启动参数。目录不存在时显示错误并允许修正；无效的新设置不会替换当前配置。

目录范围是当前会话 workspace 与 App 公共目录的合并结果，会话目录排在首位。Host 通过运行时 `MOSS_SESSION_WORKSPACE` 注入当前会话目录，不写入公共配置；启动器忽略后续客户端 Roots 变化，避免替换该范围。无会话上下文时服务检查仅使用公共目录，空范围也可列出工具，但不能访问任何文件。文件路径和符号链接边界继续由固定版本的上游实现校验。保留用户配置路径和其真实路径，以兼容 macOS `/tmp` 等目录别名。

## 上游与打包

固定使用 [`@modelcontextprotocol/server-filesystem@2026.8.31`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem/v/2026.8.31)，来源提交 [`a40bc270fb5ece62673f8a1196f57116d885c5eb`](https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/filesystem)。上游文件保持原样，独立启动器验证目录并固定 Roots 行为。“检查服务”启动独立的临时 Node MCP 进程，验证启动、握手和工具发现，不重启会话进程。原始许可证及来源保存在 `assets/licenses/`。

服务和完整生产依赖随包提供，使用 Moss Node 运行时，无需 npx、全局依赖或运行时下载。生产依赖版本记录在 `dist/server/versions.json`，可重建源码随安装 ZIP 提供。

## 验证

```sh
bun install
bun run --cwd apps/filesystem check
bun run --cwd apps/filesystem test
bun run --cwd apps/filesystem test:browser
node scripts/package-app.mjs --app moss.filesystem
node apps/filesystem/scripts/verify-host.mjs
```

测试使用临时目录。Host 验证安装最终 ZIP，通过真实页面配置目录、调用包内工具，验证离线运行、范围限制、排除工具、启停、清空公共设置及会话默认目录。需相邻 Moss 仓库已构建 `ui/electron-direct.mjs`，也可用 `MOSS_CORE_ROOT` 指定。结果位于 `artifacts/moss.filesystem/verification/0.1.0/`。

本版本要求 Moss Host API >=3.4.0，展示入口为设置 → 工具 → 文件系统。位置由 Manifest 声明；旧安装需要更新后生效。
