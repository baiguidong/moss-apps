# 上游来源

`@modelcontextprotocol/server-filesystem` 2026.8.31，提交 `a40bc270fb5ece62673f8a1196f57116d885c5eb`。

原始许可证 `server-filesystem-LICENSE` 来自对应提交：https://github.com/modelcontextprotocol/servers/blob/a40bc270fb5ece62673f8a1196f57116d885c5eb/LICENSE 。上游正在从 MIT 过渡到 Apache-2.0，适用条件保留在该原文中。npm 包未附带 `SEE LICENSE IN LICENSE` 所引用文件，因此单独补齐。

上游包文件未修改。Moss 的 `src/server/cli.ts` 验证目录，在导入上游前使 SDK 的 `Server.listRoots()` 返回空目录列表，以保留命令行指定的 App 授权范围。生产依赖的许可证随各包保留，实际版本见 `dist/server/versions.json`。
