# 首批本地引擎 App 交付记录

本轮新增三款 Moss App，均以独立工作区页面展示常用操作，任务结果在页面与 Agent 间共享。发行目标为 macOS Apple Silicon，版本均为 `0.1.0`。

| App | 页面功能 | Agent 高级入口 |
| --- | --- | --- |
| [备份与恢复](../apps/backup/README.md) | 配置密码、初始化备份库、备份目录、浏览快照与文件、恢复、校验 | 六个原生工具；`raw` 可使用完整 Restic 参数，密码由 Moss 凭据库提供 |
| [本地数据工作台](../apps/data-workbench/README.md) | 预览 CSV、JSON、Parquet，执行 SQL，导出 CSV、JSON、Parquet | 六个原生工具和 CLI skill；`raw` 可使用完整 DuckDB CLI 参数 |
| [音视频工坊](../apps/media-tools/README.md) | 媒体信息与预览、裁剪、压缩、音频提取、GIF 与 MP4 转换 | 六个原生工具和 CLI skill；`raw` 可使用完整 FFmpeg 参数 |

页面遵循 Moss App 外框与内页布局规范：内页直接进入业务工作区，支持浅色、深色与 440px 窄窗口。任务记录包含参数、状态、日志及可导出的产物。Restic 密码保存在 Moss Credential Vault，任务记录不保存密码。

## 验证

- `bun run validate` 和三款 App 的类型检查、单元测试、构建通过。
- 隔离源码重建与 Backend 握手通过；发行 ZIP 位于 `artifacts/moss.<app-id>/0.1.0/`。
- 真实引擎验证了 Restic 备份及按内容恢复、DuckDB CSV 查询和 Parquet 导出、FFmpeg 视频裁剪及音频提取。
- 在安装后的真实 Moss 外框中，验证了三款 App 的页面任务、Agent 工具发现、CLI skill 发现、Agent 完整参数入口和共享任务记录；浅色、深色及窄窗口截图与报告位于 `artifacts/next-local-apps/ui/`。

Linux 引擎资源已预留，但本轮没有 Linux 运行环境，因此发行声明仅包含完成实测的 macOS Apple Silicon。发行 ZIP 是本地构建产物，未发布到应用市场。
