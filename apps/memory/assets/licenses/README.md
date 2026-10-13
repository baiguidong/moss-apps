# 第三方来源

- `@modelcontextprotocol/server-memory` 2026.8.31，MCP 官方参考实现；来源提交 `a40bc270fb5ece62673f8a1196f57116d885c5eb`。npm 包遗漏了其 `SEE LICENSE IN LICENSE` 引用的文件，故将该提交的完整原文保存在 `server-memory-LICENSE`。上游正从 MIT 过渡到 Apache-2.0，适用条件以保留的原文为准。
- 来源：https://github.com/modelcontextprotocol/servers/blob/a40bc270fb5ece62673f8a1196f57116d885c5eb/LICENSE
- 原包完整保留在 `dist/memory-server/node_modules/@modelcontextprotocol/server-memory/`；Moss 在独立启动器中指定数据路径并对写操作增加互斥锁，不改写上游包文件。
- `proper-lockfile` 4.1.2（MIT）及其他运行依赖的许可证随原包目录提供，完整版本清单位于 `dist/memory-server/versions.json`。

## 图谱展示

- AntV G6 5.1.1（MIT）：https://github.com/antvis/G6
- 许可证保留在 `g6-LICENSE`，图谱前端随应用打包。
