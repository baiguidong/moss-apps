# 分步思考 · Sequential Thinking

Moss 分步思考 App。启用后自动注册并检查自己的 Sequential Thinking MCP 服务，无需 MCP 管理 App。在“设置 → Apps → 分步思考”查看连接状态和工具目录，刷新状态或重新连接。Manifest 声明 `toolScope: "global"`：授权与连接正常后，各会话都能按需发现和调用工具，无需先在会话中选择 App；停用后不再提供工具。在应用管理中启用、停用和查看后台状态。

需要支持 `moss.mcp/v1` 与 App 工具范围的 Moss Desktop（Host API ^3.4.0），授予 MCP 读取、管理和连接权限。用于复杂排错、方案比较、规划中的步骤记录、修正与分支。模型按任务需要调用，不要求每个问题都执行分步工具；它不会独立验证事实或保证推理正确，多次调用会增加耗时和 token。

## 工具和状态

固定版本暴露 `sequentialthinking` 工具，支持 `thought`、`thoughtNumber`、`totalThoughts`、`nextThoughtNeeded`，以及修正和分支字段。实际名称以该版本工具目录为准。工具仅在对应 MCP 进程内保存步骤和分支，不写入本地文件；独立连接使用独立历史，进程重启后清空。长期保存信息请使用记忆 App。

启动器在加载上游前设置 `DISABLE_THOUGHT_LOGGING=true`，防止上游将步骤正文输出到 stderr。工具调用仍遵循 Moss 本身的对话和调用记录机制，此设置不关闭 Host 记录。

App 自动重建自己的固定启动配置，并在后台发现工具，不阻塞 Backend 就绪握手。设置页通过 `servers.list` 读取真实状态、通过 `servers.inspect` 重新连接，均仅接受空对象。关闭设置页不会停止后台服务。启停及工具刷新沿用 Host 生命周期，忙碌对话在当前轮结束后生效。

## 上游和分发

固定使用 [`@modelcontextprotocol/server-sequential-thinking@2026.8.31`](https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking/v/2026.8.31)，来源提交 [`a40bc270fb5ece62673f8a1196f57116d885c5eb`](https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/sequentialthinking)。这是 MCP 项目官方参考实现，Moss 提供 App 封装。原包、完整生产依赖和许可证随包提供，使用 Moss Node 运行时，无需 npx、全局安装或运行时联网下载。

上游包文件不修改。启动器只设置关闭正文日志的环境变量。包内 `assets/licenses/` 保存原提交的许可证，依赖许可证保留在各包目录，实际版本见 `dist/sequential-server/versions.json`。

## 验证

```sh
bun install
bun run --cwd apps/sequential-thinking check
bun run --cwd apps/sequential-thinking test
node scripts/package-app.mjs --app moss.sequential-thinking
node apps/sequential-thinking/scripts/verify-host.mjs
../moss/ui/node_modules/.bin/electron apps/sequential-thinking/scripts/verify-ui.mjs
```

Host 验证使用相邻 Moss 仓库，可通过 `MOSS_CORE_ROOT` 指定，需已有 `ui/electron-direct.mjs`。使用临时 App 数据安装真实 ZIP，检查离线工具调用、修正和分支、连接隔离、日志、后台自动发现及启停。报告写入 `artifacts/moss.sequential-thinking/verification/<version>/`。

本版本要求 Moss Host API >=3.4.0，通过 `navigation.location: "settings"` 与 `contributes.settings` 将页面展示在“设置 → Apps”中。旧安装需要更新后生效。
