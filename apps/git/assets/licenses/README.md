# 参考实现与适配

- 参考包：`mcp-server-git` 2026.8.18（MIT），官方源仓库 https://github.com/modelcontextprotocol/servers/tree/main/src/git 。
- 固定源码分发：https://files.pythonhosted.org/packages/c1/40/df8626a07853166320547045a719cef66ff31c91dda13e8b988ec4cf08ea/mcp_server_git-2026.8.18.tar.gz 。
- `git-reference-server.py` 与 `git-reference-LICENSE` 原样取自该 sdist 的 `src/mcp_server_git/server.py` 和 `LICENSE`，仅用于来源核对，不在运行时执行。
- Moss 在 `src/server/` 将 12 项工具移植到 TypeScript/Node，使用 MCP TypeScript SDK 和本机 Git 替代 Python SDK/GitPython。增加多仓库显式范围、输入限制、环境覆盖隔离和字面暂存路径。详细行为差异见 App README。
- MCP SDK、Zod 等运行依赖的原始许可证随包保留，版本列表位于 `dist/server/versions.json`。
