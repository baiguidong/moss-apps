# Excel 表格

在会话中选择此 App，创建、读取和编辑本地工作簿、公式与图表。无需安装 Excel；支持 XLSX、XLSM、XLTX、XLTM，不支持旧 XLS 文件。

需要 Host API 3.11 和 Python >=3.11。首次连接下载 excel-mcp-server 2.0.0 及依赖。默认允许当前用户主目录及子目录，相对路径以主目录为起点，不随会话目录变化。

Moss Core 需包含新版 MCP 服务信息的兼容修复。旧 Core 若在检查服务时提示 serverInfo 含额外字段，需要更新 Core，不能仅重装此 App。

在设置 → 连接配置的 args 中，将 `--allow-dir` 后的 `~` 改为需要的目录，如 `~/Documents`。可重复 `--allow-dir` 参数增加目录，也可增加 `--read-only` 只读参数。默认不启用 VBA 写入。

不同会话不要同时编辑同一工作簿。上游：https://github.com/haris-musa/excel-mcp-server 。MIT 许可证原文随包保留。
