# 代码地图

0.1.2 新增 Linux AMD64 独立包。原生依赖随对应平台包交付；Linux 在 Ubuntu 24.04 验证。浏览器内 App 页面仍依赖 Moss Web Host 的独立适配。

`moss.code-map@0.1.2`，Moss Desktop Host API >=3.14，平台为 macOS Apple Silicon 和 Linux AMD64。使用 codebase-memory-mcp v0.12.0 的上游 MCP 服务进行索引和查询。

在“更多 → 代码地图”选择本地仓库、建立索引，再搜索符号。点击符号读取源码与直接调用关系；架构入口提供仓库文件树。全部 17 个上游 MCP 工具另有按 input schema 生成的表单和 JSON 参数编辑入口。

Agent 通过 Moss MCP tool 调用。App 的 stdio 适配器保留上游工具定义与返回结果，同时登记任务，所以 Agent 查询结果也会出现在页面。页面与 Agent 使用同一固定二进制和 App 索引目录。核心索引、源码提取、关系图和查询不使用大模型；上游 Lens UI 未作为本版界面嵌入。

本地 MCP 引擎以压缩资源包含在发布 ZIP 中，首次运行在本机解压并校验，不会启动下载。通过上游 `CBM_RUNTIME_DIR` 为每个 App 实例分配独立运行目录，同一实例的页面与 Agent 共用索引，可与其他 CBM 安装同时运行。Moss 关闭后释放其 MCP 会话，上游守护进程按自身会话生命周期退出。

上游：[codebase-memory-mcp v0.12.0](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.12.0)。MIT 及第三方声明位于 `assets/licenses/`。

## 开发与验证

在仓库根目录执行：

```sh
bun run --cwd apps/code-map check
bun run --cwd apps/code-map test
node scripts/package-app.mjs --app moss.code-map
```

安装包包含可独立重建的源码与固定 SDK。真实引擎和 Moss 容器验证分别由 `scripts/verify-engine-clis.mjs`、`scripts/verify-engine-ui.mjs` 执行；运行依赖、Core 配套变更和测试范围见 [交付记录](../../docs/engine-apps-delivery.md)。
