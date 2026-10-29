# 分步思考 · Sequential Thinking

配置型 MCP App，由 Moss Core 提供设置页、服务注册、连接检查和运行管理。启用并授予 MCP 权限后，各会话均可按需发现和调用 `sequentialthinking`，无需在会话中选择 App。在“插件 → 分步思考”查看工具和使用范围，点击服务行在右侧修改连接设置或检查服务。

## 配置与状态

- `app.json` 保存应用身份、固定版本启动命令、环境变量、全局工具范围和使用说明。
- `resources/` 保存图标、用户说明和上游许可证。
- 不包含独立 UI、Backend、启动器或运行依赖副本；公共页面和生命周期由 Core 托管，需要 Host API **3.9** 或以上兼容版本。

启动命令为 `npx -y @modelcontextprotocol/server-sequential-thinking@2026.8.31`。首次连接可能需要联网下载依赖。与 0.1.2 的内置依赖分发不同，离线可用性取决于 npm 缓存；配置型安装包本身不提供离线运行依赖。

`toolScope: "global"` 保留各会话按需使用的行为。`runtime.state: "session"` 明确保留服务内存状态，不参与无状态服务的空闲回收；各会话使用独立进程，步骤和分支不会跨会话共享。关闭会话运行时、停用 App 或重新启动服务会清空这些临时状态。长期保存内容请另行保存到文档或记忆。

`DISABLE_THOUGHT_LOGGING=true` 直接写入启动环境，关闭上游 stderr 中的步骤正文。此设置不关闭 Moss 自身的对话和工具调用记录。

## 构建与验证

在仓库根目录执行：

```sh
node scripts/run-apps.mjs check --app moss.sequential-thinking
node scripts/package-app.mjs --app moss.sequential-thinking
node scripts/verify-source-package.mjs --app moss.sequential-thinking --rebuild
node scripts/verify-sequential-thinking.mjs
```

安装包输出到 `artifacts/moss.sequential-thinking/0.1.6/`，包含配置、资源和可独立重建的生成器源码。可在支持 Host API 3.9 的 Moss 中导入 `moss.sequential-thinking-0.1.6.zip`。沿用原 App ID 和服务名称，升级到此版本后由 Core 注册配置中的服务。

真实服务验证使用相邻 Moss 仓库，可通过 `MOSS_CORE_ROOT` 指定。脚本在临时数据目录安装最终 ZIP，验证无需打开页面的全局服务注册、真实步骤/修正/分支、连接隔离、无正文日志、设置持久化和启停，结果保存在安装包目录的 `verification.json`。首次验证需要下载固定版本服务。

## 上游

固定使用 [`@modelcontextprotocol/server-sequential-thinking@2026.8.31`](https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking/v/2026.8.31)，来源提交 [`a40bc270fb5ece62673f8a1196f57116d885c5eb`](https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/sequentialthinking)。上游包不修改，许可证原文保存在 `resources/assets/licenses/`。
