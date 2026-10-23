# 文件系统

在会话中选择此 App 后，可读写当前会话工作目录。设置中的“公共目录（可选）”可添加最多 32 个已有目录；支持 `~/`，每行一个，路径含空格无需加引号。公共目录供使用此 App 的会话共享。

未配置公共目录时，仅访问当前会话目录。设置页的服务检查不附加会话目录；全部为空时可查看工具，不能读写文件。对其他会话目录的访问仍需单独配置为公共目录。

需要 Moss Host API 3.10。固定通过 `npx -y @modelcontextprotocol/server-filesystem@2026.8.31` 启动上游服务，首次连接可能下载依赖。空闲连接可以回收，磁盘文件保留。

上游来源：https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/filesystem 。许可证保存在 `assets/licenses/server-filesystem-LICENSE.txt`。
