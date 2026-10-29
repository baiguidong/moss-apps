# 记忆 · Memory

独立的 Moss 记忆 App，启用后注册自己的 MCP 服务，实际使用或主动检查时才连接，无需安装 MCP 管理 App，无需先打开页面。在对话中保存、搜索、关联、补充或删除人物、项目和偏好。

需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.22.0），授予 MCP 读取、管理和连接权限。Core 展示介绍、服务和当前版本的缓存工具；右侧页面提供记忆图谱、内容详情和记忆文件位置。普通浏览器使用明确标识的演示数据。

## 在 App 中查看记忆

在「插件 → 记忆 → 记忆图谱」可看到使用 [AntV G6](https://g6.antv.antgroup.com/)（MIT）绘制的知识图谱。采用框架内置的力导向布局、圆形节点、有向连线和交互，不自建布局或绘图引擎。节点颜色区分记忆类型，连线标注关系；点击节点查看完整内容，点击详情中的关联名称继续浏览。支持拖动节点与画布、缩放、适应画布、名称与内容搜索、类型筛选以及列表视图。列表和键盘节点导航提供无需鼠标的查看方式，浅色与深色主题随 Moss 切换。

在对话中选择记忆 App 后，可以说「记住：小林负责咖啡店网站项目，目前处于设计阶段」，再回到 App 查看人物、项目及其关系。页面可见时每 10 秒读取一次最新数据，返回窗口或点击「刷新记忆」也会更新。没有数据时展示保存引导，不往真实记忆中写入示例。

图谱通过只读 `graph.read` action 读取当前 App 的固定记忆文件，使用与 Memory MCP 相同的 JSONL 数据，无需另启动 MCP 连接。查询只接受关键词、类型和偏移量；不接受文件路径。每页最多 120 个节点，大型内容会自动减小单页数量以保持 IPC 响应在 512 KB 内。筛选和分页仅绘制当前节点之间的关系，全部记忆和关系的总数始终可见；缺失节点的关系单独提示。超过 16 MB 的文件、损坏记录或单条内容超限会明确报错，仍可通过对话工具处理。原始记忆文件不会被此视图修改。

## 数据与生命周期

记忆文件固定为当前 App `dataDir/memory/knowledge-graph.jsonl`，与安装版本和临时目录分离；更新、重启、关闭页面及停用 App 不清空文件。启用本 App 的对话共用同一份本机记忆，不会自动同步到其他设备。删除 App 数据会删除记忆。

后台根据 Host 下发的持久目录生成启动配置，不接受任意命令、脚本或文件路径。启动时检查文件读写权限，不截断已有文件。上游以临时文件加原子重命名保存，适配层再用 `proper-lockfile` 对六种写操作加跨进程锁和进程内队列，防止多个对话同时修改导致覆盖。锁等待最长约 10 秒，异常退出遗留锁约 30 秒后可恢复；文件系统操作失败会作为工具错误返回。

App 的启停与动态工具目录沿用 Host MCP 生命周期，忙碌对话在本轮结束后刷新。页面显示最近检查结果。排除工具不删除已有记忆。不会读取或迁移 MCP 管理、其他 App 或旧目录的数据。

## 上游与分发

固定使用 [`@modelcontextprotocol/server-memory@2026.8.31`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory/v/2026.8.31)，源码提交 [`a40bc270fb5ece62673f8a1196f57116d885c5eb`](https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/memory)。这是 MCP 项目的官方参考实现，App 由 Moss 封装维护。

上游包及完整生产依赖随包提供，使用 Moss Node 运行时，不使用 npx 或运行时下载。上游文件保持原样，存储路径、权限检查和写入锁由 `src/memory-server/cli.mjs` 适配。包内 `assets/licenses/` 保留该提交的原始许可证及来源，运行依赖的许可证随各包保留。构建输出 `dist/memory-server/versions.json` 记录实际版本。

## 开发与验证

```sh
bun install
bun run --cwd apps/memory check
bun run --cwd apps/memory test
bun run --cwd apps/memory test:browser
node scripts/package-app.mjs --app moss.memory
node apps/memory/scripts/verify-host.mjs
```

Host 验证使用相邻 Moss 仓库，可通过 `MOSS_CORE_ROOT` 指定，需已构建 `ui/electron-direct.mjs`。测试使用临时 App 数据和真实记忆服务，验证离线运行、记忆增删改查、并发写入、重启持久化、安装 UI 和启停。报告位于 `artifacts/moss.memory/verification/0.1.0/`。

本版本要求 Moss Host API >=3.22.0，展示入口为插件 → 记忆 → 记忆图谱。位置由 Manifest 声明；旧安装需要更新后生效。
