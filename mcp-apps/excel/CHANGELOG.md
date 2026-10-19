# Changelog

## 0.1.0

- 新增配置型 Excel App，固定 excel-mcp-server 2.0.0，通过 Core 独立 Python 环境运行。
- 默认限定当前用户主目录，支持在连接参数中调整允许目录；默认不启用 VBA 写入。
- 提供工作簿、单元格、公式与图表工具，无需安装 Excel；要求 Host API 3.11。
- 依赖 Core 对新版 MCP serverInfo 扩展字段的兼容修复，补丁随仓库保留。
