# MCP / CLI 驱动的 Moss App 候选

核查日期：2026-10-16。按最新边界选型：**开源 MCP / CLI 承担核心功能；我们实现 Moss UI、必要的调用与编排、任务状态和结果读取。用户可以完全通过按钮、表单和结果视图使用基础功能。**

本轮是下一批候选调研与 CLI 调用验证，未新增 App 安装包。此前图片、PDF、转写的交付记录保留；它们采用的库接入方式不作为下一批默认方案。

## 推荐范围

建议下一批先做 **文件清理、文档格式转换、代码地图**：前两项覆盖常见本地任务，代码地图展示目录、源码、关系图之间的交互。备份恢复与音视频工具紧随其后。若面向普通办公用户，应把备份恢复排在代码地图之前。

Stars 为当天对应仓库的关注度，CLI 引擎与 MCP 服务分别标明；不代表稳定性或 MCP 封装的热度。精确查询结果、来源及验证范围见 [数据快照](data/mcp-cli-ui-candidates-2026-10-16.json)。

| App | 开源项目 / Stars | 接口 | Moss 内的手工操作与结果 | 接入判断 |
| --- | --- | --- | --- | --- |
| 文件清理 | [Czkawka](https://github.com/qarmin/czkawka) / 34,268 | CLI | 选择目录扫描；重复文件分组、相似图片对比、大文件排序；按上游保留/清理策略处理并显示结果 | 首选。基础 CLI 不需要 GUI；首版覆盖重复文件、大文件、相似图片，视频相似度及特殊图片格式另有依赖 |
| 文档格式转换 | [Pandoc](https://github.com/jgm/pandoc) / 46,606 | CLI | 选择 Markdown、DOCX、HTML、EPUB 等格式与模板；批量转换；内嵌内容预览、产物列表和导出 | 首选。本机已验证 DOCX 与 HTML；PDF 导出需要额外 PDF 引擎，不列入单独 Pandoc 首版承诺 |
| 代码地图 | [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) / 46,677 | MCP + CLI | 选择本地仓库并索引；目录树、源码阅读、调用关系图、架构视图相互定位 | 首选 UI 展示项目。索引和图查询无需 LLM；新发布的 Lens UI 仍是 Beta，Moss 内嵌兼容性尚未验证 |
| 备份恢复 | [Restic](https://github.com/restic/restic) / 36,600 | CLI | 选择源目录和本地备份库；进度、快照时间线、快照文件树；选择文件恢复并查看结果 | 结构化接口好。首版手动备份/恢复；定时运行受 Moss Desktop 生命周期约束，应另行设计 |
| 音视频工具 | [FFmpeg](https://github.com/FFmpeg/FFmpeg) / 65,251 | CLI | 拖动起止点、压缩、提取音轨、转 GIF；内嵌播放器、参数、进度和生成结果对比 | 本机已验证裁剪、缩放、音轨提取。核心仍由 FFmpeg 提供，Moss 负责 UI 与受控参数生成 |
| 文件复制与同步 | [Rclone](https://github.com/rclone/rclone) / 60,318 | CLI + 本地 RC API | 双栏目录、复制任务、变更列表、传输进度、失败重试；可扩展到已授权云盘 | RC 提供 JSON 与异步任务，优先使用。先做复制与明确方向的同步；与现有网盘 App 区分为本地传输任务 |
| 网页诊断 | [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) / 53,620 | MCP | 输入网站或 localhost 地址；在 Moss 查看截图、请求详情、控制台错误、性能记录 | 比现有网页操控更强调诊断结果。由 App 管理 headless Chrome for Testing，用户无需另开 DevTools 查看 |
| 压缩包管理 | [7-Zip](https://github.com/ip7z/7zip) / 4,171 | CLI | 压缩包目录树、创建压缩包、指定目录解压、操作结果；支持类型的文件在 Moss 预览 | 成熟通用引擎，GitHub Stars 不是其全部使用规模。`-slt` 列表为文本，需要固定版本并验证解析 |

**已有 App 补 UI 的投入更小。** [数据库查询](../apps/database/README.md) 已接 DBHub，可补表结构、SQL 编辑、结果表格；[Excel](../mcp-apps/excel/README.md) 已接 excel-mcp-server，可补工作表、范围读写、图表配置与结果查看。当前界面主要承担连接配置，对话调用已有服务；补界面能直接满足“不依赖大模型也可使用”。Excel 的完整公式重算能力仍以该上游版本为准。

另有 [Repomix](https://github.com/yamadashy/repomix)（28,855 Stars，MCP + CLI），适合做仓库材料整理：文件勾选、包含/排除规则、输出预览、文件大小和 Token 分布。它不提供代码语义关系分析，可作为代码地图之后的轻量开发者 App。

## App 形态与代码边界

采用 `apps/<name>` 的普通 Moss App，提供自定义 `ui.entry` 与薄 Backend。现有 `mcp-apps/<name>` 的公共配置页面适合启停和配置服务；目录名称本身不意味着已经具备可交互的业务结果 UI。

调用链是：

```text
Moss UI 的按钮 / 表单
    → Backend action（参数校验、任务记录、取消、错误归一化）
    → 上游 MCP 的结构化工具调用 / CLI 参数数组 / 本地 RC JSON
    → 上游结果、文件、进度
    → Moss UI 的表格、图片、播放器、关系图或快照树
```

UI 和可选的 AI 工具复用同一套动作与任务记录。上游 MCP 返回的结果需要关联到任务与产物，不能假设一次 MCP 调用会自动刷新页面。基础任务不调用大模型。

我们负责参数适配、受管进程、版本准备、进度解析、任务编排、结果预览和导出。去重算法、备份格式、转码器、文档转换器、代码索引及图查询均复用上游。展示层可以复用开源组件；已有上游 UI 可先评估内嵌，但不以打开外部软件或网页作为最终交付。

运行依赖随 App 打包或由 App 下载、校验和管理，首次准备可联网。结果在 Moss 内查看。最终安装包应固定引擎版本与平台，验证安装后的真实运行文件；开发机 PATH 中碰巧存在命令不能算安装成功。

## 已核对的接口细节

### Czkawka：真实 JSON 文件，清理策略单独执行

[CLI 说明](https://github.com/qarmin/czkawka/blob/master/czkawka_cli/README.md) 与 [参数定义](https://github.com/qarmin/czkawka/blob/master/czkawka_cli/src/commands.rs) 确认：`dup` 查重复文件，`big` 查大文件；`-d` / `--directories` 接收目录；`-C` / `--compact-file-to-save` 指定紧凑 JSON 结果文件，`--pretty-file-to-save` 指定格式化 JSON 文件。不是猜测一个通用的 `--json` 开关。

本轮检查的是当日源码，不是已选定发行二进制的实测。最终需固定 release，用该二进制的 `--help` 和真实样例确认多目录、排除规则和 JSON 字段。扫描动作不携带删除参数；页面根据上游实际支持的保留/清理策略生成独立操作，不能把“勾选任意文件”直接等同于一个上游尚未提供的删除 API。

[结果保存代码](https://github.com/qarmin/czkawka/blob/master/czkawka_cli/src/main.rs) 在 JSON 写出失败时记录错误，适配层必须检查本次独立输出路径的文件是否存在、能否解析、是否满足对应工具的结构，不能只以退出码或旧文件认定成功。CLI 子项目明确为 MIT；根仓库 GitHub 元数据的 `NOASSERTION` 不能替代组件许可证。

### Pandoc：内容转换和实际版式预览区分

Markdown、DOCX、HTML 等转换由 CLI 完成。可以把生成的 DOCX 再交给 Pandoc 生成 HTML 内容预览；这不是 Word 页面的等比例排版预览。首版不自建 Office 排版引擎，也不把 HTML 预览声称为 DOCX 的精确版式。PDF 输出需要额外引擎，待明确运行依赖后另行纳入。

### Restic / Rclone：按实际协议处理进度与部分失败

Restic [脚本文档](https://github.com/restic/restic/blob/master/doc/075_scripting.rst) 说明 `--json` 并非所有命令都支持；有的返回完整 JSON，有的按行返回带 `message_type` 的消息。备份退出码 `3` 表示部分源文件未读到，页面必须呈现部分失败，不能显示“全部备份成功”。快照、列文件和恢复都可以使用上游输出驱动 UI。

Rclone [RC 文档](https://github.com/rclone/rclone/blob/master/docs/content/rc.md) 提供 `operations/list`、`sync/copy`、`sync/sync`、`_async`、`job/status`、`job/stop` 和 `core/stats`。通过受管本地服务发送 JSON，能减少终端文本解析。单向同步可能移除目标独有文件，UI 应明确同步方向并按上游能力展示计划；不承诺自动双向冲突解决。

### 代码地图：发布说明比旧 README 更新

查询时 README 仍称 Lens 未包含于 v0.11.0，但 [v0.12.0 发布说明](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.12.0) 已于 `2026-10-15T22:08:18Z` 发布，明确包含 **CBM Lens Beta**，可以通过 `--ui=true` 启动内置本地 UI。应以这次 release 为更新依据，不再沿用“只能从 main 构建 Lens”的旧结论。

主要 MCP 能力包括 `index_repository`、`list_projects`、`search_graph`、`trace_path`、`query_graph`、`get_code_snippet`、`get_architecture`。Moss 可用这些工具构建自己的目录、源码和图视图；内嵌 Lens 是另一个待验证方案。Beta UI 的 WebView、资源路径和生命周期兼容性未实测。可选的本地模型聊天不属于基础索引/导航所需依赖。

### 网页诊断：由 App 管理无界面浏览器

[工具表](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md) 包括导航、截图、网络请求、控制台消息、performance trace 与分析；`lighthouse_audit` 的性能部分应使用独立 trace 工具，不能混为一个完整 Lighthouse 性能分数。

服务支持 `--headless`，官方支持 Chrome / Chrome for Testing。Moss 管理浏览器运行文件和会话，显示截图与诊断结果。若采用本地分析配置，可使用 `--no-performance-crux` 与 `--no-usage-statistics` 关闭默认的额外外部请求；访问互联网网站本身仍需要联网。

## 其他项目的处理

| 项目 | 本轮结论 |
| --- | --- |
| [AntV chart MCP](https://github.com/antvis/mcp-server-chart)，4,397 Stars | 适合“数据表单 → 图表 → 导出”，但默认调用在线渲染服务。可增加薄 HTTP 适配连接官方 [GPT-Vis-SSR](https://github.com/antvis/GPT-Vis/tree/main/bindings/gpt-vis-ssr) 后本地渲染；需要验证字体、输出文件及图片 URL。地图工具依赖 AMap，不在这条本地渲染路径内 |
| [Word MCP](https://github.com/GongRzhe/Office-Word-MCP-Server)，2,108 Stars | 已归档，不作为下一批核心依赖 |
| [ExifTool](https://github.com/exiftool/exiftool)，5,169 Stars | 适合给图片工具补元数据查看/编辑，暂不重复拆出新 App |
| [Serena](https://github.com/oraios/serena)，30,303 Stars | 可做符号和引用导航，但语言服务运行依赖更多；先评估代码地图候选 |

## 调用适配必须怎样测试

**参数数组只避免 shell 拆分，不能保证功能正确。** CLI 通过 `spawn(executable, args, { shell: false })` 或等价接口调用；MCP/RC 使用结构化 JSON。随后还要验证参数次序、枚举、时间单位、范围和路径语义。FFmpeg 滤镜、通配符及 CLI 自身的参数语法仍需单独处理，不把整个用户输入当作参数模板。

| 验证层 | 必须检查的实际结果 |
| --- | --- |
| 参数与路径 | 中文、空格、引号、`[]$;&`、文件名以 `-` 开头；区分绝对路径和选项；多输入、多目录、输出已存在、空值、范围边界；按目标平台扩展路径样例 |
| MCP / RC 合约 | 固定版本工具名称与 input schema；布尔/数字不能全部转成字符串；`isError`、分页、内容块及结构化结果分别处理；Repomix sandbox 模式路径语义与普通模式不同 |
| 真实引擎结果 | Czkawka 用已知重复/不重复文件核对分组；Restic 恢复文件逐个比较哈希；Pandoc 回读实际产物；FFmpeg 用 ffprobe 和解码帧核对时间、尺寸和内容；Rclone 比较两端实际文件；7-Zip 解压后核对内容 |
| 失败与长任务 | 无权限、坏文件、磁盘不足、错误格式、输出写入失败、部分成功、取消及重新打开 App；不能把旧产物或未完成文件展示为成功 |
| Moss 安装包 | 从已安装 App 的按钮发起任务；读取实际输出并在 Moss 预览；验证依赖准备、进度、取消、导出和重开后的任务状态；只声明经过验证的平台 |

### 本轮实际执行的探针

可复跑脚本：[probe-mcp-cli.py](../scripts/research/probe-mcp-cli.py)。只使用本机已有 Pandoc / FFmpeg / ffprobe 与临时文件，不安装工具。运行：

```sh
python3 scripts/research/probe-mcp-cli.py
# 单独验证一种引擎
python3 scripts/research/probe-mcp-cli.py --engine pandoc
```

结果保存于 [CLI 探针报告](data/mcp-cli-probes-2026-10-16.json)。测试输入与输出均采用含 `-输入 中文 空格 '[]$;&` 的文件名，并作为绝对路径逐项传入 argv。

- **Pandoc 3.9.0.2：5 项检查通过。** Markdown → DOCX 保留中文标题与真实表格，生成 DOCX 可回读为 Markdown，HTML 包含预期内容；错误格式返回失败；原文件未变且没有额外产物。
- **FFmpeg / ffprobe 7.1.1-tessus：6 项检查通过。** 用红色 1 秒、蓝色 2 秒的片段和 3 秒音轨构造输入，从 1.2 秒处裁出 0.8 秒并缩放到 160×90；实际产物时长为 0.8 秒，解码首帧为蓝色，证明起点也正确；进度到达 `end`；提取 WAV 后核对 16kHz、单声道、48,000 帧；错误编码器返回失败，原文件保持不变。

这些是本机 CLI 探针，不是 Moss UI 或发布包集成测试，也不等于所有格式都已验证。其余候选本轮只核查了仓库、接口文档和部分源码，尚未实跑。最终选版后仍需按上表验收实际适配代码。

## 来源与版本记录

数据快照保留 GitHub metadata URL、README blob SHA、补充接口文档来源和 CBM v0.12.0 发布时间。许可证字段是 GitHub 元数据或本轮读取组件文档所得，不代表完整发行包的依赖审计；选版打包时保留实际引擎及依赖许可证。尤其 7-Zip 含 unRAR 条款，FFmpeg 按实际构建组件确定许可。本次探针调用的系统 FFmpeg 不是选定的 App 分发二进制。
