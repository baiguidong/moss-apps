# 本地数据工作台

Moss App 使用固定版本 DuckDB CLI 1.5.6。页面可选择 CSV、TSV、JSON、JSONL、Parquet 文件，预览、执行完整 SQL，并导出 CSV、JSON、Parquet。Agent 可通过随包 CLI skill 使用完整 SQL 和 DuckDB CLI 参数；任务与页面共享。结果预览最多 5000 行，完整大结果应导出文件。

当前发行包声明 macOS Apple Silicon。SQL 可读取用户指定的本地文件，写入命令应明确目标。首版只打包 DuckDB CLI，不预装联网扩展；需要额外扩展的 SQL 依照 DuckDB 自身行为执行。

从 0.2.0 起，可在页面点击“添加为共享数据源”，将选中的文件通过 Host API 3.18 的 `moss.dataset/v1` 提供给其他 App。跨 App 查询只接受来源 ID、列、简单筛选和分页，不能传任意本地路径或 SQL。页面“已共享数据源”可取消共享，旧查询结果引用随之失效。来源结构包含 `revision` 和 `schemaFingerprint`，组合 App 应在保存映射或发布前重新核对。

共享文件路径中的 DuckDB 通配字符按字面文件名读取，不会展开邻近文件。结果引用有效期为 15 分钟；过期文件在后续查询或读取过期引用时清理。缓存单项最多 16 MiB、总量最多 256 MiB、最多 512 项；达到上限时新查询会被拒绝，已有结果保持可读。取消共享会清理对应的缓存。来源 revision 是文件设备、inode、大小和时间戳的指纹，并非全文内容哈希。

开发：bun run --cwd apps/data-workbench check / test / build；从仓库根目录使用 node scripts/package-app.mjs --app moss.data-workbench 打包。
