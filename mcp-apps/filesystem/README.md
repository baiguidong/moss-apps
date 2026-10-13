# 文件系统 · Filesystem

配置型 MCP App。Moss Core 提供设置页、服务注册、目录校验和连接生命周期；不再包含独立 UI、Backend、启动器或运行依赖副本。需要 **Host API 3.10**。

在会话中选择“文件系统”后，工具可访问当前会话工作目录。设置中的“公共目录（可选）”支持最多 32 个已有目录，每行一个，支持 `~/` 和含空格的路径。有效范围为 **当前会话工作目录 + 此 App 的公共目录**；相对路径优先使用会话目录，公共目录可留空。只打开设置检查服务时不附加会话目录；全部为空时可以查看工具，但不能读写文件。

## 配置

`app.json` 声明固定启动命令 `npx -y @modelcontextprotocol/server-filesystem@2026.8.31`，首次连接可能需要联网下载依赖。`resources/` 保存图标、用户说明和许可证。使用 `runtime.state: "stateless"`，文件保存在磁盘，空闲连接可以回收，下次调用自动重连。

服务的 `roots` 声明会话目录绑定及公共目录列表。Core 在连接前展开路径、检查目录存在，将会话目录优先合并到启动参数中。`delivery: "arguments"` 保留 `/tmp` 等目录别名；Roots 请求返回空列表，上游保留启动时的完整授权范围。目录范围修改后沿用 Core 的连接重建机制。

从 0.1.1 升级时，Core 提取旧服务 JSON 参数中的公共目录，保留禁用工具、启停状态和服务身份，并替换旧安装路径。此后的包声明升级按原默认值、用户设置和新默认值合并，避免覆盖用户目录。

## 构建与验证

```sh
node scripts/run-apps.mjs check --app moss.filesystem
node scripts/package-app.mjs --app moss.filesystem
node scripts/verify-source-package.mjs --app moss.filesystem --rebuild
node scripts/verify-filesystem.mjs
```

生成 `artifacts/moss.filesystem/0.1.2/moss.filesystem-0.1.2.zip`。安装包携带可独立重建的配置和生成器源码，实际使用还需支持目录绑定的 Core。开发期间 `vendor/moss-core` 中的 SDK 必须与 Core 工作区对应。

上游为 [`@modelcontextprotocol/server-filesystem@2026.8.31`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem/v/2026.8.31)，来源提交 `a40bc270fb5ece62673f8a1196f57116d885c5eb`，不修改上游包。许可证原文位于 `resources/assets/licenses/`。
