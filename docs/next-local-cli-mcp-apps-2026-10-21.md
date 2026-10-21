# 下一批本地 CLI / MCP App 机会

调研日期：2026-10-21。目标是让用户在 Moss 页面中完成真实任务，Agent 与页面共享任务和结果。GitHub Stars 仅作为关注度信号，不能代替用户需求、上游接口稳定性和安装包实测。下表 Stars 为本日 GitHub API 快照，取近似值。

本仓库已交付图片、PDF、转写、文件清理、文档格式转换、代码地图、数据库连接、HTTP 调试等能力。此前的[候选清单](mcp-cli-ui-app-candidates.md)已提出 Restic、FFmpeg、Rclone；这三项仍未形成独立 App。新项目应避开已有 App 的基础功能，做到可视化配置、执行、校验和取回产物。

## 建议顺序

| 顺序 | App / 上游热度 | 用户能完成的任务 | Moss 页面应提供的关键操作 | 实施判断 |
| --- | --- | --- | --- | --- |
| P0 | **备份与恢复**：[Restic](https://github.com/restic/restic) 3.67 万 Stars | 备份指定目录、查看版本、找回单个文件或整个目录 | 源与目标选择、进度、快照时间线、文件树、恢复位置和恢复后校验 | 普通用户价值高；先做本地备份库和手动运行。Restic 有跨平台发行包，但快照/备份 JSON 输出形式不同，退出码 `3` 是部分源文件未读到。定时备份需要处理 Moss Desktop 关闭后的运行问题。 |
| P0 | **本地数据工作台**：[DuckDB](https://github.com/duckdb/duckdb) 4.23 万 Stars | 合并、清洗、筛选 CSV/JSON/Parquet 文件，导出结果 | 文件集合与列类型、字段预览、可视化过滤/连接/分组、可选 SQL、抽样图表、导出与执行记录 | 现有 DBHub 解决数据库连接，Excel MCP 解决工作簿操作；这里解决文件级数据处理。DuckDB CLI 有 macOS/Windows/Linux 原生包，优先支持内置文件格式；Excel 扩展等额外依赖须单独锁定。 |
| P0 | **音视频工坊**：[FFmpeg](https://github.com/FFmpeg/FFmpeg) 6.55 万 Stars | 裁剪、压缩、转格式、提取音轨、制作 GIF、给视频烧录已有字幕 | 时间轴和播放器、格式预设、输出大小估计、队列/进度/取消、前后对比与导出 | [旧计划](local-tool-apps-plan.md)已有设计，文件清理和转写 App 已打包 FFmpeg，能复用二进制准备经验；仍需单独验证编码器、输出可播放性和大文件。 |
| P1 | **复制与同步**：[Rclone](https://github.com/rclone/rclone) 6.04 万 Stars | 在本地、NAS 和用户已授权的云存储间复制或同步文件 | 双栏目录、变更预览、明确的同步方向、传输队列、速度/失败重试 | 可先实现本地与 S3/WebDAV，再扩展云盘；Rclone RC 有结构化列表、任务和进度接口。`sync` 可能删除目标独有文件，需在页面呈现差异后执行。与 Restic 可共用目标配置，但同步与版本化备份是两个任务。 |
| P1 | **项目安全体检**：[Trivy](https://github.com/aquasecurity/trivy) 3.86 万 Stars，可按需补 [Gitleaks](https://github.com/gitleaks/gitleaks) 3.02 万 Stars | 扫描本地项目/镜像的漏洞、错误配置和泄露密钥，导出修复清单 | 严重度与文件筛选、受影响依赖、修复版本、逐项复核、SARIF/HTML 报告 | 对开发者实用且可做很好的结果页。Trivy 漏洞库需要更新；离线状态要显示数据库日期，密钥命中结果须遮盖，不能把原值写入任务日志。 |
| P1 | **GitHub 工作台**：[GitHub CLI](https://github.com/cli/cli) 4.67 万 Stars；官方 [GitHub MCP Server](https://github.com/github/github-mcp-server) 3.38 万 Stars | 从本地仓库关联 Issue/PR、看审查意见和 CI、起草并创建 PR | 仓库与分支、Issue/PR 列表、差异/评论、Checks 状态、提交前预览 | 现有 Git MCP 面向本地仓库；此 App 补远端协作。首版用 `gh` 的结构化 JSON 与受控命令构建页面和 Agent skill；是否接官方 MCP 应按真正需要的工具再决定，避免暴露过宽的写操作。 |
| P2 | **结构化文档提取**：[Docling](https://github.com/docling-project/docling) 6.92 万 Stars；[docling-mcp](https://github.com/docling-project/docling-mcp) 776 Stars | 从扫描件和复杂 PDF 中提取章节、表格、图片位置，导出 Markdown/JSON 并导入知识库 | 原页与结构化结果并排、表格校对、页码溯源、批量任务 | MarkItDown 与 PDF 工作台已有基础文本/OCR；新增价值必须是结构、表格和来源定位。Python 与模型体积较大，建议先做现有文档 App 的增强原型，再决定是否独立上架。引擎热度不能算成 MCP 包热度。 |
| P2 | **网页媒体采集**：[yt-dlp](https://github.com/yt-dlp/yt-dlp) 19.97 万 Stars | 查看媒体信息、下载用户可访问的素材和字幕，交给转写/音视频工坊处理 | URL 元数据预览、格式和字幕选择、下载队列、文件归档与后续处理入口 | 关注度最高，但站点适配更新频繁、依赖网络与登录状态；适合在音视频工坊稳定后做独立采集入口。不要把下载成功率当作纯本地引擎能力。 |
| P2 | **本地服务中心**：[Docker Compose](https://github.com/docker/compose) 3.84 万 Stars | 启停开发环境，查健康状态、端口与日志 | Compose 项目列表、服务拓扑、日志筛选、资源使用、启动/停止前确认 | 适合开发者，但需要用户机器已有 Docker/兼容容器守护进程；随包提供 Compose CLI 也不能代替容器运行时。 |

首批建议并行做两个不同人群的原型：**Restic 备份与恢复**（普通用户）和 **DuckDB 本地数据工作台**（办公/开发用户）。音视频工坊已有较完整的旧计划和 FFmpeg 打包经验，可作为第三个落地项目。各 App 的首版任务应能完全用页面操作完成；Agent 入口随后复用同一任务数据和产物，不应另造一套执行逻辑。

## 页面与引擎怎么分工

这些候选都适合 `apps/<name>` 的普通 App，而不是只提供启停表单的配置型 MCP App。页面负责选择输入、参数、预演、结果和产物；Backend 管理固定版本的 CLI/MCP、进程、任务队列、取消和错误。CLI 用参数数组调用；MCP/RC 保留结构化参数与结果。对长任务使用持久任务记录，重开页面仍能查看状态和日志。已有的 [`packages/engine-apps`](../packages/engine-apps/)和[交付记录](engine-apps-delivery.md)可复用运行时、任务和导出模式。

| 用户动作 | 页面必须交付的结果 |
| --- | --- |
| 导入和配置 | 明确输入范围、目标位置、预计影响；凭据留在 Moss Credential Vault，不进入页面日志。 |
| 运行 | 进度、可取消状态、失败原因和部分成功文件；取消后不把临时文件当成功产物。 |
| 检查 | 直接在 Moss 预览快照、数据表、视频、扫描结果或 PR 状态；支持按任务导出。 |
| Agent 调用 | 与页面共享任务 ID、参数和产物；高影响写操作遵循明确的目标和预演结果。 |

Moss Backend 随 Desktop 退出；备份、同步与下载的“定时/无人值守”需要额外的系统级调度设计，不能由普通 App 的 `persistent` 生命周期保证。新 App 应锁定上游版本与哈希、只声明实测平台、打包对应许可证；首次联网准备、模型/漏洞库更新和运行时离线能力分别标明。

## 应先增强现有 App 的方向

- **数据库查询**：现有 [DBHub App](../apps/database/README.md)主要提供连接管理；可在同一 App 增加 SQL 编辑、表结构、查询结果表和导出，成本低于再做一个通用数据库 App。DuckDB 的独立边界是文件级数据处理。
- **Excel MCP**：先补工作簿/工作表/范围的页面操作；不要把 DuckDB 描述为 Excel 公式编辑器。
- **网页诊断**：[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) 约 5.39 万 Stars，有网络、控制台和性能工具；但 [网页操控 App](../apps/browser-use/README.md) 已托管浏览器。优先评估在原 App 中增加诊断页面，避免第二个 Chrome 生命周期管理器。
- **图片元数据**：ExifTool 更适合扩展 [图片工具](../apps/image-tools/README.md)；Repomix 更适合扩展 [代码地图](../apps/code-map/README.md) 的仓库打包/Token 统计入口。这些能力尚不足以优先新建独立 App。

## 来源与核查边界

以上项目关注度、最近推送、归档状态和仓库许可证来自 2026-10-21 的 GitHub 仓库 API；所列项目当日均未归档。已核对最新发行版：DuckDB `v1.5.6`、Restic `v0.19.1`、Rclone `v1.75.2`、yt-dlp `2026.08.19`、Trivy `v0.76.0`、GitHub CLI `v2.102.1`、Docling `v2.141.0`、Docker Compose `v5.6.0`。这些是调研时版本，不是已选定的 Moss 打包版本。

接口依据：[Restic 脚本文档](https://github.com/restic/restic/blob/master/doc/075_scripting.rst)、[Rclone RC 文档](https://github.com/rclone/rclone/blob/master/docs/content/rc.md)及各项目官方仓库。当前没有为这些新候选制作 Moss 安装包或完成跨平台 CLI/MCP 实跑。进入开发前，需用固定发行文件验证参数、结构化输出、权限/错误、取消和真实结果；GitHub Stars 也不代表发行包中所有依赖的许可证。
