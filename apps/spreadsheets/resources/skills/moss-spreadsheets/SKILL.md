---
name: moss-spreadsheets
description: 创建、分析、读取或修改本地 XLSX、CSV、TSV 的数据、公式、格式和图表时使用。此 App 不控制正在运行的 Excel。
---

# 表格创作

## Moss 使用方式

用户在主会话表达需求。读取工具参数说明，由模型填写结构化参数，不要求用户编写代码、HTML 或 JSON。
App 默认全局常驻，无需选择 App。打开 App 只显示宿主通用信息与设置；不要引导用户去独立工作台完成任务。
提交任务后查询到 succeeded 才能交付。调用 moss_present(result.presentation) 在右侧展示，并在回复使用 result.displayMarkdown。需要下载时提供 result.downloads 中的原始文件资源链接，导出到本地目录使用对应 export 工具。
修改生成新任务，能传 parentId 时传原任务 ID，保留旧文件。先读取原任务 input 或参考文件，保留用户未要求改变的内容。整份修改在主会话表达，预览中的局部修改复用 Moss 标注，不创建整体“继续修改”按钮。
遵循用户指定的模板、格式和输出数量。生成后检查内容、可编辑性和预览；内容预览不能证明 Office 原生排版完全一致。发现不支持的功能应说明，不用截图替换可编辑的文档、单元格或图表。

## 参数与文件

spreadsheet_guide 返回完整参数。spreadsheet_create 提交任务，spreadsheet_status 查询，spreadsheet_read 读工作簿数据，spreadsheet_export 导出。
新建：title 和 sheets=[{name,rows,widths,charts}]。单元格可以是文本、数值、布尔值，公式写成 {formula:"SUM(B2:B5)",numFmt:"#,##0.00"}，不把公式结果硬编码成数字。同一行的列按数组排列。
图表支持 bar/line/pie，labels 为单列单元格范围，series=[{name,range}]；生成原生 Excel 图表，不用图片代替。
读取：mode=read、sourcePath 为 XLSX/CSV/TSV 完整路径。修改：mode=edit、sourcePath、edits=[{sheet,cell,value}] 或 {sheet,cell,formula}。导入 XLSX 的未修改部件保留；新文件不会覆盖来源。
## 计算与质量

实际数据、假设、计算和输出职责清晰；简单任务优先少量工作表，按需增加。用户指定的工作簿结构优先，不强制额外封面或审计页。
公式计算必须成功，出现 #REF!、#VALUE!、循环依赖或不支持的函数时先修复，不以伪造缓存值交付。数值格式与单位相符，日期、百分比和货币不混淆。
源数据的含义与历史数值保持不变；预测条件集中管理，汇总可追溯到明细。交付前核对合计、边界值、公式引用和图表数据。
预览最多展示前 300 行、40 列；完整内容在 XLSX 中。需要云端 Google Sheets 或连接中的 Excel 时使用对应连接能力，不声称本地 XLSX 已上传或同步。

适配范围与原始插件版本见 [adaptation.md](references/adaptation.md)。

## 实际页面核验

Office 结果优先展示原文件，右侧由 Moss 渲染实际页面；不要用内容 HTML 替代真实版式。result.visualReview 返回渲染状态、pageCount、pdfPath 和 pages[].path。只有 status=rendered 表示全部页面图片已生成，visuallyVerified=false 表示仍须模型逐页查看；不能把渲染成功说成视觉核验完成。查看图片，检查溢出、重叠、中文字体、表格和分页，有问题修改原生内容后重新生成、重新查看。表格还需检查公式、格式和数值。

若状态 unavailable / failed / pdf-only / partial，如实说明缺少的核验步骤。Office 需要本机 LibreOffice，逐页 PNG 需要 Poppler（pdftoppm/pdfinfo）；也可将已有 pdfPath 交给 PDF App 的 render 模式生成图片。不要把缺失依赖的结果称为排版已验证。原文件与页面预览均可在主会话重新打开，支持页码、缩略图、缩放和局部标注。

## 原文定位、局部修改与核验记录

spreadsheet_inspect({id}) 读取真实内容和 citation.displayMarkdown，支持 page / sheet / range 过滤与 offset / limit 分页。引用事实时复用返回的引用，点击即可在主会话右侧定位原文；不要编造页码或单元格。Word 段落用原文文字定位，PPT 用真实幻灯片顺序，Excel 用工作表及单元格地址。

spreadsheet_verify({id}) 返回结构检查和待查看的页图。逐页使用可用的图片读取工具查看原图，再用 id、sourceSha256、pages=[{page,observations,issues:[{severity,message}]}] 记录实际观察；无问题时 issues=[]。可以分批记录，只有完整页图和全部页记录才算完成。needs-repair 时先修改源内容并生成带 parentId 的新版本，再检查新版本；最多连续修复 3 轮，仍有问题如实交付限制和待解决项。缺少依赖、部分页面或模型未实际查看图片时，不能声称已视觉核验。纯读取、解释原文不需要为交付生成物执行完整核验流程。

局部修改保留未涉及的内容，使用对应 App 的编辑参数创建新任务。result.comparison 提供真实原文件之间的结构对比，右侧工具栏也有入口。涉及修改时可附 comparison.displayMarkdown；保留原件引用以便核对排版。

大文件默认先生成 8 页核验图片，原文件和完整 PDF 可先展示。`spreadsheet_verify` 返回 `rendering`、`nextRender`；需要检查其余页面时，用返回的 `nextRender` 参数调用同一工具，或传 `{id,sourceSha256,render:{startPage,count}}`（每批 1–20 页）。先查看该批实际图片，再提交核验记录。超时或中断后可重新查询并续跑；不要重复创建整份文件。`partial` 表示还有页图待生成，不等于生成物损坏。问题可以在右侧核验列表点击定位，继续使用原有局部标注提交修改要求。
