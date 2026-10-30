本次修正的六个创作 App 工具描述（2026-10-30）

以下 41 条为各 App 的 `contributes.tools[].description` 原文，已经通过 Moss 的 `toolToAPISchema` 核对，最终 API 工具描述与这里一致。验证使用本地请求构造逻辑，不是网络抓包。

Core 的 `AppContributionTool.prompt()` 现在直接采用 `instructionsText || description`，不再追加英文 App 来源句。若其他内部工具声明了独立 instructions 文件，仍优先使用该文件。

范围为可视化、文档、PDF、表格、演示文稿和模板；浏览器及其他 MCP 服务的描述未修改。本次修改源仓库，已安装 App 包需构建并更新后采用新版文案。

**可视化 · moss.visualize · 5 个工具**

定义文件：[app.moss.json](../apps/visualize/app.moss.json)

| 工具 | 修正后的描述 |
| --- | --- |
| `visualize_create` | 根据 CSV 数据生成柱形图、折线图、饼图、散点图或表格，或保存提供的自包含 HTML 交互演示。mode=chart 使用 csv，mode=html 使用 html。返回任务 id，用 visualize_status 查询；修改已有作品时传 parentId 并提供完整新内容，保留旧版本。 |
| `visualize_status` | 按任务 id 查询生成状态、错误和产物。成功后调用 moss_present(result.presentation) 展示作品，并在回复中原样使用 result.displayMarkdown。 |
| `visualize_list` | 列出可视化任务的 id、输入参数、状态和产物清单，用于查找已有作品或确定后续修改的 parentId。 |
| `visualize_export` | 将任务 id 和产物 index 指定的文件复制到用户通过目录选择器选择的位置；同名文件自动另取名。返回保存路径 path，取消选择时返回 canceled=true。 |
| `visualize_templates` | 获取支持的图表类型、可改写的 HTML 演示模板，以及交互状态保存和追问接口的使用说明，用于准备 visualize_create 的输入。 |

**文档 · moss.document · 7 个工具**

定义文件：[app.moss.json](../apps/document-converter/app.moss.json)

| 工具 | 修正后的描述 |
| --- | --- |
| `document_create` | 从 Markdown 创作 DOCX、PDF、HTML、Markdown 或 EPUB（mode=author，传 title、content、to）；也可用 paths 批量转换或合并文档，或用 mode=review、sourcePath、edits/comments 为 DOCX 添加修订和批注。返回任务 id，用 document_status 查询。关联旧版本时传 parentId，原文件保留。 |
| `document_status` | 按任务 id 查询状态、日志和产物；成功的 DOCX/PDF 主文件还提供内容索引、页图及核验状态。交付前用 document_verify 检查实际页图；展示使用 moss_present(result.presentation)，回复使用 result.displayMarkdown。 |
| `document_list` | 列出文档任务的 id、输入参数、状态和产物清单，用于查找历史文档、原稿和导出文件。 |
| `document_read` | 按任务 id 和产物 index 读取 Markdown、HTML、JSON 等 UTF-8 文本文件，返回 text，单文件最多 2 MiB。读取 DOCX/PDF 正文请用 document_inspect。 |
| `document_export` | 将任务 id 和产物 index 指定的文档或辅助文件复制到用户选择的目录；同名文件自动另取名。返回保存路径 path，取消选择时返回 canceled=true。 |
| `document_inspect` | 读取成功任务主文件的内容索引：DOCX 返回段落编号和文字，PDF 返回逐页原文；包含检查结果及可点击引用。支持 offset/limit 分页，PDF 可按 page 筛选。局部修订前先读取段落编号和原文。 |
| `document_verify` | 检查成功任务的 DOCX/PDF 主文件：仅传 id 获取真实页图、文件指纹和核验进度；带 sourceSha256 和 render 分批生成页图；查看图片后带同一指纹及 pages 提交逐页观察和问题。生成页图与提交观察分开调用，发现错误后创建新版本再核验。 |

**PDF · moss.pdf · 7 个工具**

定义文件：[app.moss.json](../apps/pdf-tools/app.moss.json)

| 工具 | 修正后的描述 |
| --- | --- |
| `pdf_import` | 按 paths 中的本地绝对路径复制导入 PDF，保留原文件。返回成功导入的 files（含文件 id、页数和表单字段 metadata.fields）及逐文件 errors；后续处理使用文件 id。 |
| `pdf_list` | 列出已导入和已生成的 PDF、文本及图片文件，以及任务状态和输出文件 id。PDF 的页数、表单字段及当前值见 metadata；文件的 displayMarkdown 可用于展示引用。 |
| `pdf_create` | 创建或处理 PDF：options.mode=create 使用 options.content 生成文字 PDF，无需 fileIds；其他模式使用已有 fileIds，支持合并/重排/旋转页面、拆分、提取文字、离线 OCR、填写表单和渲染页图。options.pages 中原页码从 0 开始，表单字段名先用 pdf_list 查询。返回任务 id，用 pdf_status 查询；关联旧版本时传 parentId。 |
| `pdf_export` | 按文件 ids 将 PDF、提取的文本或页图复制到用户选择的目录；同名文件自动另取名。返回 files 中的保存路径及 canceled 状态。ids 使用 pdf_list 或 pdf_status 返回的文件 id。 |
| `pdf_status` | 按任务 id 查询处理状态、进度、错误和输出文件。成功且产物含 PDF 时还返回主 PDF 的内容索引、页图及核验状态；用 pdf_verify 核验。展示使用 moss_present(result.presentation)，回复使用 result.displayMarkdown。 |
| `pdf_inspect` | 按任务 id 读取成功任务中主 PDF 的逐页原文、检查结果和可点击页码引用。page 从 1 开始，支持 offset/limit 分页。仅适用于产物含 PDF 的任务；扫描件的文字识别使用 pdf_create 的 ocr 模式。 |
| `pdf_verify` | 检查成功任务的主 PDF：仅传任务 id 获取真实页图、文件指纹和核验进度；带 sourceSha256 和 render 分批生成页图；查看图片后带同一指纹及 pages 提交逐页观察和问题。生成页图与提交观察分开调用，发现错误后创建新版本再核验。 |

**表格 · moss.spreadsheets · 8 个工具**

定义文件：[app.moss.json](../apps/spreadsheets/app.moss.json)

| 工具 | 修正后的描述 |
| --- | --- |
| `spreadsheet_create` | 创建、读取或修改表格。mode=create 用 sheets 生成 XLSX，支持公式重算、格式和柱形/折线/饼图；mode=read/edit 用 sourcePath 导入 XLSX、CSV 或 TSV，edit 用 edits 修改单元格。返回任务 id，用 spreadsheet_status 查询。关联旧版本时传 parentId，源文件保留。 |
| `spreadsheet_status` | 按任务 id 查询状态、日志和产物；成功后返回工作表概况、文件引用及核验状态。交付前用 spreadsheet_verify 检查实际页图；展示使用 moss_present(result.presentation)，回复使用 result.displayMarkdown。 |
| `spreadsheet_list` | 列出表格任务的 id、输入参数、状态和产物清单，用于查找已有工作簿、源文件和历史版本。 |
| `spreadsheet_read` | 按任务 id 和产物 index 读取工作簿数据 JSON、创作参数或 HTML 预览等 UTF-8 文本，返回 text，单文件最多 2 MiB。按工作表或单元格范围读取内容请用 spreadsheet_inspect。 |
| `spreadsheet_export` | 将任务 id 和产物 index 指定的 XLSX 或辅助文件复制到用户选择的目录；同名文件自动另取名。返回保存路径 path，取消选择时返回 canceled=true。 |
| `spreadsheet_guide` | 获取 create/read/edit 模式、支持的图表类型和完整参数 JSON Schema，用于构造 spreadsheet_create 的输入。 |
| `spreadsheet_inspect` | 读取成功任务的工作簿内容索引，返回单元格位置、值、公式、检查结果和可点击引用。可按 sheet 与 range（如 B2:C8）筛选，并用 offset/limit 分页；指定 range 时必须同时提供 sheet。 |
| `spreadsheet_verify` | 检查成功任务的工作簿：仅传 id 获取实际打印页图、文件指纹和核验进度；带 sourceSha256 和 render 分批生成页图；查看图片后带同一指纹及 pages 提交逐页观察和问题。生成页图与提交观察分开调用，发现错误后创建新版本再核验。 |

**演示文稿 · moss.presentations · 8 个工具**

定义文件：[app.moss.json](../apps/presentations/app.moss.json)

| 工具 | 修正后的描述 |
| --- | --- |
| `presentation_create` | 创建、读取或修改 PPTX。mode=create 用 slides 定义文字、图片、表格、图表、形状和备注；mode=read/edit 使用 sourcePath，edit 支持 replacements 文字替换及 objectEdits 对象修改。返回任务 id，用 presentation_status 查询；对象修改前先用 presentation_inspect 定位，关联旧版本时传 parentId，源文件保留。 |
| `presentation_status` | 按任务 id 查询状态、日志和产物；成功后返回 PPTX 引用、内容索引及核验状态。交付前用 presentation_verify 检查实际幻灯片页图；展示使用 moss_present(result.presentation)，回复使用 result.displayMarkdown。 |
| `presentation_list` | 列出演示文稿任务的 id、输入参数、状态和产物清单，用于查找已有 PPTX 和历史版本。 |
| `presentation_read` | 按任务 id 和产物 index 读取幻灯片内容 JSON、创作参数或 HTML 预览等 UTF-8 文本，返回 text，单文件最多 2 MiB。读取 PPTX 对象及定位信息请用 presentation_inspect。 |
| `presentation_export` | 将任务 id 和产物 index 指定的 PPTX 或辅助文件复制到用户选择的目录；同名文件自动另取名。返回保存路径 path，取消选择时返回 canceled=true。 |
| `presentation_guide` | 获取 create/read/edit 模式、页面尺寸、英寸坐标单位和完整参数 JSON Schema（含支持的元素类型），用于构造 presentation_create 的输入。 |
| `presentation_inspect` | 读取成功任务的 PPTX 内容索引，返回幻灯片对象 ID、文字、位置、对象详情及可点击引用。可按 page（从 1 开始）筛选，并用 offset/limit 分页；局部修改使用返回的对象 ID。 |
| `presentation_verify` | 检查成功任务的 PPTX：仅传 id 获取实际幻灯片页图、文件指纹和核验进度；带 sourceSha256 和 render 分批生成页图；查看图片后带同一指纹及 pages 提交逐页观察和问题。生成页图与提交观察分开调用，发现错误后创建新版本再核验。 |

**模板 · moss.templates · 6 个工具**

定义文件：[app.moss.json](../apps/templates/app.moss.json)

| 工具 | 修正后的描述 |
| --- | --- |
| `template_create` | 保存、应用或更新可复用模板。mode=save 接收 sourcePath 或 content 及复用说明；mode=use 接收 templateId 和 values，替换文本中的 {{变量名}}，Office 参考文件需交给对应创作工具继续生成；mode=update 使用 templateId，并传 parentId=templateId 保留版本关联。返回任务 id，用 template_status 查询；保存和更新会生成待安装的模板技能包。 |
| `template_status` | 按任务 id 查询状态、日志、参考文件和模板说明。保存或更新成功后还返回 result.skillBundle，需按其 nextStep 安装后才可作为个人技能使用。展示使用 moss_present(result.presentation)，回复使用 result.displayMarkdown。 |
| `template_list` | 列出模板任务的 id、输入参数、状态和产物清单，用于查找可复用模板及历史版本；应用或更新时以原任务 id 作为 templateId。 |
| `template_read` | 按任务 id 和产物 index 读取模板参数 JSON、Markdown 技能说明、文本参考或 HTML 预览，返回 text，单文件最多 2 MiB。Office、PDF、图片和 ZIP 产物应使用文件引用或导出。 |
| `template_export` | 将任务 id 和产物 index 指定的参考文件、模板说明或技能 ZIP 复制到用户选择的目录；同名文件自动另取名。返回保存路径 path，取消选择时返回 canceled=true。 |
| `template_guide` | 获取 save/use/update 模式、支持的参考文件格式和完整参数 JSON Schema，用于构造 template_create 的输入。 |

验证：工具适配层 16 项测试通过；41 条本地 API 工具描述与 manifest 完全一致；参数 schema 和工具归属信息保持一致；六份 manifest 仅工具 description 发生修改；差异格式检查通过。

**后续修正的参数定义**

- 表格、演示文稿的 `schemas/start.json` 为 `mode` 补齐 `create/read/edit` 枚举，与各自后端能力目录一致。`mode` 仍可省略；表格现有的 `sheets + edits` 调用也通过校验。
- 模板的 `schemas/start.json` 将 `values` 的值限定为字符串、数字或布尔值，移除文本替换后端不接受的 `null`；空字符串、`0` 和 `false` 均保留。

验证了模式 schema 与后端校验的正常和错误输入；实际运行模板保存与应用，核对了空字符串、数字零、布尔 false、中文和换行的替换结果，以及 null 的拒绝行为。再次核对了 41 个工具的最终 API schema，新增枚举、可选 mode 和模板变量类型均完整传递。
