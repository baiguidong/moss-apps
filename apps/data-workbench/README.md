# 本地数据工作台

Moss App 使用固定版本 DuckDB CLI 1.5.6。页面可选择 CSV、TSV、JSON、JSONL、Parquet 文件，预览、执行完整 SQL，并导出 CSV、JSON、Parquet。Agent 可通过随包 CLI skill 使用完整 SQL 和 DuckDB CLI 参数；任务与页面共享。结果预览最多 5000 行，完整大结果应导出文件。

当前发行包声明 macOS Apple Silicon。SQL 可读取用户指定的本地文件，写入命令应明确目标。首版只打包 DuckDB CLI，不预装联网扩展；需要额外扩展的 SQL 依照 DuckDB 自身行为执行。

本 App 仅处理用户指定的本地文件，不声明跨 App 数据协议或工具依赖，也不提供数据源共享入口。常规工具继续注册给 Host，由 Host 处理调用授权。文件选择、后台任务保活和产物链接使用 Host 能力，需要 Host API 3.20.0。

页面预览和自动生成的读取 SQL 将文件路径中的 DuckDB 通配字符按字面文件名处理，不会展开邻近文件。

开发：bun run --cwd apps/data-workbench check / test / build；从仓库根目录使用 node scripts/package-app.mjs --app moss.data-workbench 打包。
