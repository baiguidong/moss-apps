# 面向本地任务的 Moss App 选型

后续更新（2026-10-16）：本篇保留首轮调研状态；首批图片、PDF、转写已见 [交付记录](local-task-apps-delivery.md)。下一批按“自定义 UI + 薄 Backend + 开源 MCP / CLI”选型，最新候选、CBM v0.12.0 发布变化和真实 CLI 参数测试见 [更新调研](mcp-cli-ui-app-candidates.md)。

调研日期：2026-10-16。目标是丰富 Moss 的日常任务能力：用户在 Moss 内导入材料、操作、检查实际结果并导出。上游可以只有 CLI、库或 MCP，展示层由 Moss App 开发；查看结果不依赖另装 PDF 阅读器、Office、播放器或其他桌面编辑器。

本记录是选型与接入设计，尚未创建下列新 App，也未实测它们在 Moss 安装包中的运行表现。Stars 来自当天 GitHub API，只代表对应仓库的关注度，不是稳定性、下载量或 MCP 封装自身的热度。精确数据见 [查询快照](data/local-task-app-research-2026-10-16.json)。

## 推荐结论

首批建议做 **图片工具、PDF 工作台、语音转写**。这三类任务常见，结果易于检查，分别展示 Moss 的图片交互、文档页面操作和音频与文字联动。后续加入音视频工具和演示文稿；图表优先结合现有 Draw.io 的定位决定是否新增白板。

依赖随 App 打包或由 App 自动下载、校验和管理。首次准备可能联网，准备完成后的基本处理及结果查看可以本地完成。涉及模型的 App 要明确选择本地模型；摘要等额外 AI 功能不能等同于离线转写。

| 建议 App | 开源来源与当日 Stars | 用户完成的任务 | Moss 内展示的实际结果 | 接入判断 |
| --- | --- | --- | --- | --- |
| 图片工具 | [sharp](https://github.com/lovell/sharp) 32,763；[rembg](https://github.com/danielgatis/rembg) 25,094 | 批量压缩、调整尺寸、转换格式、裁剪；后续增加抠图 | 原图/结果对比、透明背景预览、裁剪框、尺寸和文件大小、批量结果画廊 | sharp 是 Node 库；rembg 有 CLI/库/HTTP。基础处理接入较轻，抠图增加 Python/ONNX 和模型管理 |
| PDF 工作台 | [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) 35,042；[pypdf](https://github.com/py-pdf/pypdf) 10,259；[PDF.js](https://github.com/mozilla/pdf.js) 54,007 | 合并、拆分、旋转和重排页面；扫描件增加可搜索文字层 | PDF.js 页面预览、缩略图排序、选页操作、OCR 文字搜索与定位、生成文件预览 | 页面操作与显示可先交付；OCR 增加 Tesseract、语言包及 Ghostscript 等运行依赖 |
| 语音转写 | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 54,421；[FFmpeg](https://github.com/FFmpeg/FFmpeg) 65,244 | 将本地录音/视频转为带时间戳的逐字稿和字幕 | 播放器、时间轴、逐句文本、点击文字跳转播放、修改文本、导出 TXT/SRT/VTT | 本地 CLI，Apple Silicon 有 Metal 支持；模型、音频预处理、长任务和中文效果需验证 |
| 音视频工具 | [FFmpeg](https://github.com/FFmpeg/FFmpeg) 65,244 | 视频压缩、裁剪、提取音轨、转 GIF、格式转换 | 内嵌播放器、起止点选择、输入/输出对比、进度、完成后直接播放 | 本地 CLI；主要成本是大文件、跨平台二进制、编码器与预览兼容性 |
| 演示文稿 | [Marp CLI](https://github.com/marp-team/marp-cli) 3,870；[Slidev](https://github.com/slidevjs/slidev) 49,073 为另一方案 | 将本地 Markdown 做成演示文稿，修改内容与主题，导出 HTML/PDF | 幻灯片缩略图、编辑与预览联动、主题选择、Moss 内放映 | 首版建议 Marp；HTML 预览直接内嵌，PDF/图片导出需 App 管理浏览器运行依赖 |
| 白板/图表 | [Excalidraw](https://github.com/excalidraw/excalidraw) 133,940 | 绘制流程图、架构图、草图，AI 生成后人工调整 | 可缩放画布、选中/拖拽/编辑图形、撤销重做、PNG/SVG 导出 | 上游提供可嵌入 React 组件。先明确与现有 Draw.io 的区别；AI 工具与画布状态同步由 App 实现 |

以上 Stars 属于实际列出的引擎或 UI 库，不能称为“这些项目都有同等热度的 MCP 服务”。CLI/库完全可以经 Moss Backend actions 接入，再按需要注册 AI 工具，不必为了接入额外寻找第三方 MCP 壳。

## 首批 App 的完整使用流程

### 图片工具：第一优先

用户选择一组本地图片，设置宽度与质量，查看真实转换结果，再批量保存。首版用 sharp 完成 JPEG/PNG/WebP 转换、压缩、缩放和裁剪；抠图作为第二阶段。

界面采用文件列表、中央预览和参数区。滑动对比应显示实际生成的图片；文件大小、尺寸和格式读取真实产物。参数变化使旧预览失效，批处理支持部分成功和失败重试。处理前后文件均可在 App 内查看。

建议 ID 沿用现有规划中的 `moss.image-tools`。已有 [本地工具方案](local-tool-apps-plan.md) 包含这一方向，可在其基础上实施。

### PDF 工作台：第二优先

用户导入多个 PDF，在缩略图中选择、旋转、拖动排序，合并为一个新文件；结果直接在 Moss 内翻页和搜索。扫描件可追加 OCR，并显示可选取、可搜索的文字层。

首版拆为两步：先做可验证的页面操作与 PDF.js 内嵌预览，再加入完整 OCR 运行包。PDF.js 负责渲染，不负责执行 OCR、合并或修改 PDF。生成产物后重新加载结果文件进行检查，不能只保留输入预览。

这与现有 MarkItDown 的“提取内容为 Markdown”不同，新增的是 PDF 文件本身的整理与可视化操作。建议 ID 为 `moss.pdf-tools`。

### 语音转写：第三优先

用户导入录音或视频，选择语言并开始转写；完成后在 Moss 内播放原音频、按句查看和修订逐字稿，导出字幕。视频输入先由 FFmpeg 提取/转换音频。

首版优先文件转写，不承诺实时会议、自动识别所有说话人或录音设备控制。中文使用多语言模型，不使用仅英语的 `.en` 模型。上游列出的模型文件大小从 tiny 的 75 MiB 到 large 的 2.9 GiB，App 应提供明确的下载进度与模型选择。

摘要、行动项提取可以后续调用 Moss 已配置的模型，但需与本地语音识别能力分开描述。建议 ID 为 `moss.transcription`。

## 原生 MCP 候选

如果希望另外补充“直接复用热门 MCP”的开发者能力，以下两项更合适：

| 项目 | 当日 Stars / 许可证 | 本地能力 | 可开发的 Moss UI | 注意事项 |
| --- | --- | --- | --- | --- |
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | 46,674 / MIT | 本地代码索引、符号查询、调用关系和影响分析；索引与图查询无需云服务/API key | 目录树、源码阅读、调用关系图、查询结果定位 | 上游 README 区分当前 v0.11.0 发布版和 main 上未随该版本发布的 CBM Lens Beta；不能把新 UI 当作稳定版交付能力 |
| [Repomix](https://github.com/yamadashy/repomix) | 28,851 / MIT | CLI 和 `--mcp`；将本地仓库整理为适合 AI 阅读的文件 | 文件勾选树、排除规则、输出预览、文件贡献大小/Token 统计 | 是代码材料整理工具，不等于代码语义分析；可作为代码工作台的较轻首版 |

这些能够补充现有 Git 仓库和开发工具：现有开发工具主要是 JSON、时间戳、加密及 HTTP，未提供代码关系图。面向普通用户的首批扩充仍建议优先图片、PDF 与转写。

## 对其他热门项目的判断

| 项目 | 核查结果 | 本轮处理 |
| --- | --- | --- |
| [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)，94,288 Stars | 支持自托管本地 API 和 PDF UI；根 LICENSE 对 `engine/`、多个 proprietary/desktop/saas 目录明确指定独立许可证 | 可做后续重型 PDF 引擎候选；本轮不把整个仓库简单认定为 MIT，也未完成这些子目录授权与分发核对 |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp)，198,155 Stars | 成熟本地下载 CLI，任务本身需要访问在线站点 | 适合后续给音视频 App 增加素材下载，当前先覆盖本地文件处理 |
| [Docling](https://github.com/docling-project/docling)，68,950 Stars；[docling-mcp](https://github.com/docling-project/docling-mcp)，773 Stars | 文档结构提取引擎与独立 MCP 项目，热度不能混用 | 可用于现有文档转换/知识库的增强，不优先再新增内容提取类 App |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)，53,612 Stars | 浏览器诊断方向有价值 | 后续可做控制台、网络及性能报告；现阶段日常本地文件任务覆盖更优先 |
| [mcp-for-blender](https://github.com/ahujasid/mcp-for-blender)，30,975 Stars | 原 `blender-mcp` 地址已重定向；控制 Blender 的社区插件 | 依赖外部 Blender 应用，不符合本轮无需另装查看软件的优先条件 |
| [Pascal Editor](https://github.com/pascalorg/editor)，24,894 Stars | MIT；有本地 CLI/MCP 和 React Three Fiber 界面 | 可自动管理本地运行时，但 3D 建筑属于专项任务；README 展示的 Pascal Next 演示明确尚未包含在开源 editor 发布中 |
| [Office-PowerPoint-MCP-Server](https://github.com/GongRzhe/Office-PowerPoint-MCP-Server)，1,856 Stars | 仓库已归档 | 不选为新 App 的长期核心依赖 |
| [Excalidraw MCP](https://github.com/excalidraw/excalidraw-mcp)，5,528 Stars | 有本地 stdio，但其 UI 使用 MCP Apps 扩展；API 未识别许可证 | 不假设 Moss 普通 MCP 接入就会显示该 UI。优先使用明确 MIT 的 Excalidraw 编辑器组件开发 Moss 展示层；本轮未确认该 MCP 仓库的授权 |

## Moss 接入方式与已确认的实现边界

新增完整操作界面的 App 放在 `apps/<name>`，使用独立 `ui.entry` 和一个由 Desktop 管理的 Node Backend，日常操作入口放在“更多”。`mcp-apps/<name>` 的通用配置页适合服务启停配置，不是这些结果工作台的最终形态。

UI 通过 Backend actions 操作本地引擎；AI 工具与 UI 应复用相同的任务、项目和产物记录。用户让 AI 处理文件后，打开 App 应能看到相同任务的结果，手工调整后也更新同一份状态。上游有原生 MCP 时可通过 `moss.mcp/v1` 接入，但要另外设计 AI 调用与页面之间的状态同步，不能认为 MCP 工具执行会自动触发 UI 刷新。

建议共同验收以下完整流程：

1. 在 Moss 选择本地输入，显示可检查的输入预览。
2. 通过按钮或会话执行，页面显示真实状态与进度；长任务可取消。
3. 成功后加载真实输出，支持放大、播放、翻页或文字定位。
4. 导出可用文件；重新打开 App 后仍能找到任务与结果。
5. 关闭 Moss 后不会遗留不受管理的处理进程；失败信息可帮助用户重试。

当前源码中需要处理的公共问题：

- `file.pick` 和 `file.materialize` 仍受 `platformLimits.fileBytes = 100 * 1024 * 1024` 约束，即 100 MiB（Host 错误信息标为 100 MB）。大视频和长录音需要补齐大文件通道。
- `file.pick` 返回已授权的本地媒体 URL，可作为预览接入的基础；App 新生成的文件也需要正式的授权/暴露路径，不能直接假设任意本地路径都能放进 WebView。
- 当前 `file.download` 已采用流式写入，但仍有文件大小上限，且是 URL 下载入口。不能沿用旧方案中“整体读入内存”的判断；本地产物的导出通道仍需单独落实。
- 音视频播放器支持的编码格式与 FFmpeg 支持的格式不同。不能原生播放的输入需生成兼容预览；输出结果应区分最终文件与预览副本。
- 大文件不通过普通 JSON action 返回。长任务采用任务 ID、进度与小型产物元数据；进程生命周期要覆盖后台任务，而不是返回任务 ID 后即被空闲回收。
- Python、原生二进制、模型、字体和浏览器资源由 App 管理，需固定版本、校验摘要、处理可执行权限并验证实际目标平台。用户不需要执行安装命令才能查看结果。

## 许可证与功能边界

- sharp 为 Apache-2.0；rembg 为 MIT，但不同抠图模型和在线 provider 有各自条件。首版只选明确允许所需用途的本地模型，不能把 rembg 的所有模式统称为离线。
- OCRmyPDF 为 MPL-2.0，PDF.js 为 Apache-2.0；OCRmyPDF 的外部程序需随所选构建核对。GitHub 本轮未给 pypdf 识别出标准 SPDX，正式选版时再读取其许可证原文。
- whisper.cpp 为 MIT。FFmpeg 默认主要为 LGPL-2.1-or-later，启用可选 GPL 组件会改变许可，`--enable-nonfree` 构建不可据此当作可再分发包；以实际分发二进制为准。
- Marp CLI 为 MIT。默认 PPTX 是渲染后的页面图像；可编辑 PPTX 是实验选项，还依赖 LibreOffice，因此首版以 Markdown 编辑、HTML/PDF 展示和导出为主，不承诺完整 PowerPoint 编辑能力。
- Excalidraw 编辑器组件为 MIT；实时协作等网站功能不等于全部包含在可嵌入组件中。本地画布与持久化可以独立实现。

来源以表中项目仓库、README 和许可证为准。FFmpeg 细则见 [LICENSE.md](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md)，Stirling 目录许可划分见 [LICENSE](https://github.com/Stirling-Tools/Stirling-PDF/blob/main/LICENSE)。本仓库接入依据包括 [README](../README.md)、[SDK 说明](app-sdk.md)、[Platform Host](../vendor/moss-core/ui/src/apps/app-platform-host.mjs) 和相邻 Moss 主仓库的 `ui/docs/app-authoring.md`。
