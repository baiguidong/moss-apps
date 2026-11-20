# Moss App 合并分析

2026-11-20，按当前工作区的 Manifest、后端实现和本机运行实例盘点。

**建议先做音视频，办公创作同时做工具精简。** 音视频有实际跨 App 调用、相同的 FFmpeg 二进制和两套常驻后端。办公创作的六个 App 已经没有独立业务前端，后端也都按需启动，优先收益是减少每轮送给模型的相似工具。

## 当前开销

| 盘点对象 | 结果 | 对合并的影响 |
| --- | --- | --- |
| `apps/*/app.moss.json` | 33 个 App，26 个声明自定义 UI，30 个声明 Node 后端，其中 15 个常驻、15 个按需 | UI 数量统计的是可打开的页面入口，实际渲染进程数要在打开工作台时测量。节省空闲内存先看已启用的常驻实例，节省使用中内存再看同时打开的工作台和引擎。 |
| `contributes.tools` | 119 个静态原生工具。六个创作 App 合计 41 个，均声明 `global + always` | 119 是各 App 的声明总和。实际会话还受安装、启用、选择、用户覆盖和授权影响。MCP 动态工具另计。 |
| `tool-apps/*/app.json` | 121 个声明式工具包，其中 114 个连接器、7 个本地工具包 | 它们没有各自的业务前端和 App Backend 工程。运行时仍可能有 MCP 或 CLI 子进程，适合按实际使用的服务启动和释放。 |

本机开发版 Moss 在 11:15（上海时间）有三个音视频 Node 后端同时运行。音视频工坊 0.2.0 为 20.5 MiB RSS，HyperFrames 0.3.8 为 18.5 MiB，语音转写 0.1.0 为 18.1 MiB，三者合计约 **57.1 MiB**。另有图片工具 0.1.3 为 21.2 MiB。这四个已安装版本均声明常驻。这是上述 Node 后端的单次 RSS 采样。评估净节省还要比较合并前后的页面、引擎子进程及共享内存。

**可以先验证的优化**是把图片工具和语音转写升级到市场已有的 0.1.4。两者在本次采样合计 39.3 MiB，新版在运行任务时向 Host 登记活动，空闲后可退出。Host 按需后端默认空闲超时 60 秒，仍有请求或活动时继续运行。[图片市场版本](https://baiguidong.github.io/moss-apps/v1/apps/moss.image-tools.json) · [转写市场版本](https://baiguidong.github.io/moss-apps/v1/apps/moss.transcription.json) · [图片变更](../apps/image-tools/CHANGELOG.md) · [转写变更](../apps/transcription/CHANGELOG.md) · [Host 空闲回收](../vendor/moss-core/packages/app-runtime/src/process/index.mjs)

## 哪些 App 放在一起

以下按主要处理对象覆盖 33 个应用工程。工具数量按当前源码统计。

| 建议 | 当前 App | 产品和进程边界 |
| --- | --- | --- |
| **第一批，音视频工坊** | `media-tools`、`transcription`、`hyperframes` | 沿用 `moss.media-tools`。剪辑、转写与字幕、数字人口播、分镜动画共用素材、工作台、任务和导出。三者在 Apple Silicon 锁定同一份 FFmpeg，后两类视频项目保留各自编辑器和渲染方式。目标为一套 UI、一份调度后端，引擎由作业启动。 |
| **第二批，办公创作** | `document-converter`（实际 ID 为 `moss.document`）、`pdf-tools`（`moss.pdf`）、`spreadsheets`、`presentations`、`templates`、`visualize` | 统一作品、版本、检查和导出。六者均已使用 Host 页面及按需后端，先改默认工具加载，再合并任务与作品接口。PDF 的导入文件 ID、Office 的任务 ID、交互可视化的预览状态要分别兼容。 |
| **先统一用户入口，再选检索引擎** | `library`、`knowledge-rag`、`anything-rag` | 建议以 `library` 承接资料集、编辑和引用。面向 Agent 只提供一项知识搜索，按资料集配置选择全文或混合检索。用相同中文资料比较两种 RAG 的 Recall@5、无答案误召回、引用正确性和内存，再决定迁移哪一套。过渡期保留旧库的数据归属。 |
| **可合并目录、工具和调度入口** | `workflow`、`takt` | 两者均常驻，共有 14 个原生工具，都涉及读、建、改、运行。让定义或运行 ID 定位引擎，新建时默认使用普通工作流，已有 TAKT YAML 沿用 TAKT。先统一目录及操作，再处理两种引擎的暂停、恢复、幂等和中断语义。 |
| **可共用查看页** | `audit`、`trace` | 同一会话可从审计发现跳到调用详情，两者均无原生 Agent 工具。审计的后台规则扫描与追踪的 Host 采集需要分别启停。统一页面的收益主要在排查体验。 |
| **可共用维护页，独立执行** | `backup`、`file-cleaner` | 文件清理的常驻后端值得单独改为任务保活、空闲退出。二者可共用本地目录选择和历史，但扫描、删除、备份和恢复保留各自入口，沿用清理确认、恢复目标和密码处理。 |
| **可共用数据入口，保留两种数据源** | `data-workbench`、`database` | DuckDB 分析本地 CSV/Parquet，DBHub 使用配置好的数据库连接和凭据。两者后端均按需。通过已有文件引用或连接 ID 选择数据源，保留数据库的只读设置。 |
| **作为可选素材页** | `image-tools` | 静态图片的批量裁剪、水印和压缩有独立用途，且已支持 Linux。音视频工坊可先接受它产出的图片。客户常在同一任务中处理封面、海报和视频时，再共用素材页，保留一个明确的图片处理入口。 |
| **保留独立** | `drive`、`mcp`、`computer-use`、`browser-use` | 前三者均无普通 App Backend。网盘涉及云端分享和删除，MCP 管理托管服务配置，电脑操控走桌面授权。浏览器另用 Playwright MCP。保留各自凭据、授权和会话选择。 |
| **保留独立** | `feishu`、`openim`、`buddy`、`memory` | 两个消息通道分别维护账号与收发状态，Buddy 持有角色和会话，Memory 提供记忆图谱和 MCP 服务。口播可以复用已有技术组件，角色相似不足以合并消息身份或设置权限。 |
| **保留独立** | `devtools`、`code-map`、`app-builder`、`self-test` | HTTP 调试、源码索引、构建安装和隔离自测有不同执行权限及生命周期。自测会启动独立测试实例，其工具不宜随诊断查看页暴露。 |

外部连接器可以按供应商和能力改善发现。例如可灵和 Canva 都各有中国与海外条目。地区、账号和服务端点在设置时确定，按所选服务提供能力。用户只要求本地裁剪或转写时，暴露本地工具即可。[工具包组织](tool-app-organization.md) · [App 子服务与范围](../vendor/moss-core/ui/docs/app-authoring.md#app-子服务选择)

## 音视频的 Agent 接口

三个 App 现有 **12 + 3 + 11 = 26** 个原生工具。今天，工坊生成录音字幕要跨 App 依次调用 `files_import`、`tasks_start`、`workspace_get`，每 800 毫秒读取一次工作区以寻找该任务。这是最值得先合并的调用路径。合并后把素材引用交给内部队列，按任务 ID 返回结果。转写编辑器仍可校对字幕，动画编辑器仍可改分镜。[转写调用实现](../apps/media-tools/src/backend/transcribe.mjs) · [HyperFrames](../apps/hyperframes/README.md) · [转写与字幕](../apps/transcription/README.md)

建议第一版在选中工坊的会话中提供下列 **7 个工具**。工具名是接口草案。

| 工具 | Agent 据什么选择 |
| --- | --- |
| `media_edit` | 输入已有音视频，输出修改后的文件。如裁剪、压缩、提音轨、转 GIF。 |
| `media_transcribe` | 输入录音或视频，输出逐字稿、SRT 或 VTT。附带字幕的口播可由渲染流程内部调用转写。 |
| `video_project_save` | 新建或按版本修改可继续编辑的口播或分镜项目。已有项目由引用确定类型。 |
| `video_render` | 按已保存的项目版本制作成片，或生成该口播项目的配音试听。 |
| `media_get` | 只读。按任务、项目或素材引用取进度、错误、内容和产物。查历史时按类型分页。 |
| `media_cancel` | 按任务 ID 取消指定作业。 |
| `media_export` | 将已生成的产物保存到用户选定位置。 |

例如“把这段录音转成 SRT”一次调用 `media_transcribe` 即可提交，“裁出第 10 至 30 秒”调用 `media_edit`，“把第三个分镜缩短后重新出片”依次调用 `video_project_save` 和 `video_render`。导入、模板列表、角色选择、渲染心跳和领取作业等细节留给 UI Action、后端或对应技能。写工具按操作给出必填字段与枚举，提交结果直接返回任务 ID 和可用的产物引用。

共用工坊后，打开剪辑页只加载剪辑组件。Whisper 模型与 Chromium 渲染分别在对应任务开始时加载，CPU/GPU 高占用作业用同一队列限并发。口播当前依赖可见窗口录制，关闭窗口、取消、重启后的中断和重试须沿用原语义。目标是将两个常驻调度后端合到一个，再验证其能否在没有任务或活跃录制时退出。转写目前同时支持 Apple Silicon、Linux x64，另两个 App 仅声明 Apple Silicon。Linux 版和离线模型交付完成前，应保留原独立转写入口。[工坊 Manifest](../apps/media-tools/app.moss.json) · [转写 Manifest](../apps/transcription/app.moss.json) · [动画 Manifest](../apps/hyperframes/app.moss.json)

## 办公创作的 Agent 接口

六个内置创作 App 的 41 个工具里，光是每种格式各自的状态、列表、导出就有 **18 个**。可以先试行 `global + on-demand`，保留用户在普通会话直接说“生成一份 PPT”的用法，验证工具发现成功率。该加载策略作用于整个 App。统一作品接口后，建议保留 **6 个按成果命名的业务工具 + 3 个共用工具 = 9 个**。Word 创作与修订、现有 PDF 的合并/OCR/填表、Excel、PPT、可复用模板和独立交互图表各有一个入口。通用的 `work_get` 查询当前会话中的作品、状态或正文，`work_verify` 核验产物，`work_export` 保存文件。按格式查询的参数指南交给技能，旧版本关联、逐页核验和产物指纹留在后端。[41 项现有工具](creation-app-tool-descriptions.md) · [会话存储实现](../packages/engine-apps/src/session-backend.mjs)

用最终成果消除歧义。例如“写一份报告并导出 PDF”由文档创作负责，“识别这份扫描 PDF”由 PDF 工具负责，“把图表放在可编辑 XLSX 里”由表格工具负责，“做一个能点选筛查的独立图表”由可视化工具负责。每个入口都应能从用户要求的成果选出来，并只接受该类任务所需的参数。

## 切换与验收

1. **先建立基线。** 用同一桌面版本、启用集合、平台和素材，记录冷启动并空闲两分钟、打开工作台、执行转写/剪辑/渲染、任务结束后再空闲两分钟四种状态。分别记录存活的后端、renderer 和引擎子进程、RSS、首任务延迟。图片与转写升级后先测一次，工坊合并后再测一次。[Moss 资源监视器](../vendor/moss-core/ui/src/resource-monitor/resource-monitor.mjs)
2. **先切内部调用，再切对外名称。** 工坊目前显式依赖转写 App 的三个工具，`anything-rag` 的 OCR 也显式依赖 `moss.pdf` 的四个工具。先让消费者支持新接口并验证，再退出旧接口。旧 App 与新 App 并存期间，同一会话只公布一套模型工具。仍需跨 App 调用的能力可通过有版本的协议兼容。六个办公 ID 同时属于 Core 内置清单，物理合包需协调桌面内置包和更新流程。[工坊转写依赖](../apps/media-tools/src/backend/transcribe.mjs) · [知识库 OCR 依赖](../apps/anything-rag/src/backend/pdf-ocr.mjs) · [Core 内置清单](../vendor/moss-core/packages/app-sdk/src/builtin-apps.json)
3. **用旧数据验迁移。** 复制或导入后建立旧 ID 与新 ID 的映射，原库留作回退。验证原会话选择、权限、草稿与版本、旧作品引用（如 `moss-studio://`、`moss-hyperframes://`、`moss-pdf://`）、会话之间的数据隔离、取消和未完成任务恢复策略。可选模型按平台提供，新工坊首次打开不同时加载转写、动画和角色渲染。
4. **用真实说法验工具。** 固定模型和提示，回放裁剪、提音轨、录音转写、口播、改分镜、写报告成 PDF、扫描 PDF OCR、表内图表等请求，比较首个业务工具选对率、端到端成功率、误调用/重试数、实际送模的工具数和 schema token 数。任务成功率与选对率至少达到原方案，且暴露工具数或 schema 开销下降，再推广给默认会话。若提供可分别选择的子服务，Host 已支持 `toolSelection: "services"`。从旧父 App 选择或资源引用恢复时可能展开为整组，需单独验证这一路径。[Host 工具范围与子服务](../vendor/moss-core/ui/docs/app-authoring.md#工具范围)
