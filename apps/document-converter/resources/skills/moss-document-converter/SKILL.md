---
name: moss-document
description: 创作、修改或转换 Word、DOCX、PDF、HTML、电子书时使用；阅读、批注和修订应保留原文件。
---

# 文档创作

## Moss 使用方式

用户在主会话表达需求。读取工具参数说明，由模型填写结构化参数，不要求用户编写代码、HTML 或 JSON。
App 默认全局常驻，无需选择 App。打开 App 只显示宿主通用信息与设置；不要引导用户去独立工作台完成任务。
提交任务后查询到 succeeded 才能交付。调用 moss_present(result.presentation) 在右侧展示，并在回复使用 result.displayMarkdown。需要下载时提供 result.downloads 中的原始文件资源链接，导出到本地目录使用对应 export 工具。
修改生成新任务，能传 parentId 时传原任务 ID，保留旧文件。先读取原任务 input 或参考文件，保留用户未要求改变的内容。整份修改在主会话表达，预览中的局部修改复用 Moss 标注，不创建整体“继续修改”按钮。
遵循用户指定的模板、格式和输出数量。生成后检查内容、可编辑性和预览；内容预览不能证明 Office 原生排版完全一致。发现不支持的功能应说明，不用截图替换可编辑的文档、单元格或图表。

## 创作与修改

用 document_create，mode=author，title、content 为模型生成的 Markdown，to 选择 docx/pdf/html5/gfm/epub3。先确定读者与主结论，使用真实数据和用户提供的来源，保留限定条件与不确定性。
已有文件用 paths 指定本地完整路径；导入 Word 用 from=docx、to=gfm 提取正文，再读取 document_read 的文本产物。普通重写可重新创作；格式敏感的窄范围修改不要通过格式转换冒充原生保真编辑。
使用 document_status 查询任务，document_read 读取源稿，document_list 查历史，document_export 导出。修改传 parentId。
Pandoc 保留标准标题、段落、列表、表格、引用与图片；复杂版式先检查转换结果。中文 PDF 使用内置 Typst 和中文字体。不得把 HTML 内容预览称为 Word 逐页排版校验。
需要 Word 原生修订或批注时使用 mode=review 的 edits/comments 参数，必须检查返回的修订或批注结果。不要把替换后的普通文本称为修订记录。

适配范围与原始插件版本见 [adaptation.md](references/adaptation.md)。

## 实际页面核验

Office 结果优先展示原文件，右侧由 Moss 渲染实际页面；不要用内容 HTML 替代真实版式。result.visualReview 返回渲染状态、pageCount、pdfPath 和 pages[].path。只有 status=rendered 表示全部页面图片已生成，visuallyVerified=false 表示仍须模型逐页查看；不能把渲染成功说成视觉核验完成。查看图片，检查溢出、重叠、中文字体、表格和分页，有问题修改原生内容后重新生成、重新查看。表格还需检查公式、格式和数值。

若状态 unavailable / failed / pdf-only / partial，如实说明缺少的核验步骤。Office 需要本机 LibreOffice，逐页 PNG 需要 Poppler（pdftoppm/pdfinfo）；也可将已有 pdfPath 交给 PDF App 的 render 模式生成图片。不要把缺失依赖的结果称为排版已验证。原文件与页面预览均可在主会话重新打开，支持页码、缩略图、缩放和局部标注。

## 原文定位、局部修改与核验记录

document_inspect({id}) 读取真实内容和 citation.displayMarkdown，支持 page / sheet / range 过滤与 offset / limit 分页。引用事实时复用返回的引用，点击即可在主会话右侧定位原文；不要编造页码或单元格。Word 段落用原文文字定位，PPT 用真实幻灯片顺序，Excel 用工作表及单元格地址。

document_verify({id}) 返回结构检查和待查看的页图。逐页使用可用的图片读取工具查看原图，再用 id、sourceSha256、pages=[{page,observations,issues:[{severity,message}]}] 记录实际观察；无问题时 issues=[]。可以分批记录，只有完整页图和全部页记录才算完成。needs-repair 时先修改源内容并生成带 parentId 的新版本，再检查新版本；最多连续修复 3 轮，仍有问题如实交付限制和待解决项。缺少依赖、部分页面或模型未实际查看图片时，不能声称已视觉核验。纯读取、解释原文不需要为交付生成物执行完整核验流程。

局部修改保留未涉及的内容，使用对应 App 的编辑参数创建新任务。result.comparison 提供真实原文件之间的结构对比，右侧工具栏也有入口。涉及修改时可附 comparison.displayMarkdown；保留原件引用以便核对排版。

Word 修订支持同一段落内跨文字片段的 find/replace，保留原有样式和原生修订。文字重复时使用 inspect 返回的 paragraph 定位；字段、超链接等复杂结构跨越会明确拒绝。

大文件默认先生成 8 页核验图片，原文件和完整 PDF 可先展示。`document_verify` 返回 `rendering`、`nextRender`；需要检查其余页面时，用返回的 `nextRender` 参数调用同一工具，或传 `{id,sourceSha256,render:{startPage,count}}`（每批 1–20 页）。先查看该批实际图片，再提交核验记录。超时或中断后可重新查询并续跑；不要重复创建整份文件。`partial` 表示还有页图待生成，不等于生成物损坏。问题可以在右侧核验列表点击定位，继续使用原有局部标注提交修改要求。
