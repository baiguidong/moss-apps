# 分步思考

启用并授权后，各会话可按需使用 `sequentialthinking` 记录步骤、修正和分支，无需在会话中选择 App。在“插件 → 分步思考”查看工具，点击服务行打开右侧连接设置；查看不会启动服务。

此应用仅包含配置和资源，界面及运行管理由 Moss Core 提供，需要 Host API 3.9 或以上兼容版本。

固定运行 `npx -y @modelcontextprotocol/server-sequential-thinking@2026.8.31`，首次连接可能需要联网下载。`DISABLE_THOUGHT_LOGGING=true` 关闭上游 stderr 的步骤正文，不影响 Moss 自身的对话记录。

各会话使用独立进程，步骤历史只保存在该进程内存中，不写入本地文件。服务声明 `runtime.state: "session"`，使用后保留连接；关闭会话运行时、停用或重启服务会清空临时步骤和分支。

上游来源：https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/sequentialthinking 。原提交的许可证保存在 `assets/licenses/server-sequential-thinking-LICENSE.txt`。
