---
name: moss-presentations
description: 创建、编辑、读取或检查 PowerPoint/PPTX 演示文稿时使用，保留可编辑文字、表格和图表。
---

# 演示文稿创作

## Moss 使用方式

用户在主会话表达需求。读取工具参数说明，由模型填写结构化参数，不要求用户编写代码、HTML 或 JSON。
App 默认全局常驻，无需选择 App。打开 App 只显示宿主通用信息与设置；不要引导用户去独立工作台完成任务。
提交任务后查询到 succeeded 才能交付。调用 moss_present(result.presentation) 在右侧展示，并在回复使用 result.displayMarkdown。需要下载时提供 result.downloads 中的原始文件资源链接，导出到本地目录使用对应 export 工具。
修改生成新任务，能传 parentId 时传原任务 ID，保留旧文件。先读取原任务 input 或参考文件，保留用户未要求改变的内容。整份修改在主会话表达，预览中的局部修改复用 Moss 标注，不创建整体“继续修改”按钮。
遵循用户指定的模板、格式和输出数量。生成后检查内容、可编辑性和预览；内容预览不能证明 Office 原生排版完全一致。发现不支持的功能应说明，不用截图替换可编辑的文档、单元格或图表。

## 参数与文件

presentation_guide 返回完整参数。presentation_create 提交任务，presentation_status 查询，presentation_read 读取内容，presentation_export 导出。
新建传 title、slides。每页可有 title、body、notes、background、elements。元素类型 text、image、table、chart、shape；位置 x/y/w/h 为英寸，宽屏画布 13.333×7.5。图片使用本地完整路径，图表使用 series 的 labels/values。
布局由模型决定，优先用户提供的品牌、模板与版式。要求 N 页即总共 N 页，不额外添加封面。每页只表达需要表达的主题，使用简洁标题；事实与引用应有来源，引用放在对应页备注中。
正文推荐至少 17pt，普通正文默认 22pt。遇到拥挤先整理内容，不无限缩小字体。页面元素不能超出画布。表格和图表保留原生编辑能力，图片不要拉伸。
修改本 App 生成的作品：读取原任务 input，修改 slides，传 parentId 重新生成。导入 PPTX 用 mode=read、sourcePath；定点文字修改用 mode=edit、replacements=[{find,replace,slide}]，slide 从 1 开始。导入后的内容预览不代表原生幻灯片的完整视觉排版。
## 检查与交付

检查页数、信息完整性、数据准确性、文字溢出、图表与图片比例，并逐页查看预览。保留可编辑文字、图表与表格，不用整页截图替代 PPT。
使用真实素材与用户资料；不要用装饰形状伪造真实图标、人物或事实依据。普通图示可以使用原生形状，保持可编辑。
生成的 PPTX 是本地文件；Google Slides 需要额外导入能力。没有连接或实际上传就不能声称创建了在线幻灯片。

适配范围与原始插件版本见 [adaptation.md](references/adaptation.md)。

## 实际页面核验

Office 结果优先展示原文件，右侧由 Moss 渲染实际页面；不要用内容 HTML 替代真实版式。result.visualReview 返回渲染状态、pageCount、pdfPath 和 pages[].path。只有 status=rendered 表示全部页面图片已生成，visuallyVerified=false 表示仍须模型逐页查看；不能把渲染成功说成视觉核验完成。查看图片，检查溢出、重叠、中文字体、表格和分页，有问题修改原生内容后重新生成、重新查看。表格还需检查公式、格式和数值。

若状态 unavailable / failed / pdf-only / partial，如实说明缺少的核验步骤。Office 需要本机 LibreOffice，逐页 PNG 需要 Poppler（pdftoppm/pdfinfo）；也可将已有 pdfPath 交给 PDF App 的 render 模式生成图片。不要把缺失依赖的结果称为排版已验证。原文件与页面预览均可在主会话重新打开，支持页码、缩略图、缩放和局部标注。

## 原文定位、局部修改与核验记录

presentation_inspect({id}) 读取真实内容和 citation.displayMarkdown，支持 page / sheet / range 过滤与 offset / limit 分页。引用事实时复用返回的引用，点击即可在主会话右侧定位原文；不要编造页码或单元格。Word 段落用原文文字定位，PPT 用真实幻灯片顺序，Excel 用工作表及单元格地址。

presentation_verify({id}) 返回结构检查和待查看的页图。逐页使用可用的图片读取工具查看原图，再用 id、sourceSha256、pages=[{page,observations,issues:[{severity,message}]}] 记录实际观察；无问题时 issues=[]。可以分批记录，只有完整页图和全部页记录才算完成。needs-repair 时先修改源内容并生成带 parentId 的新版本，再检查新版本；最多连续修复 3 轮，仍有问题如实交付限制和待解决项。缺少依赖、部分页面或模型未实际查看图片时，不能声称已视觉核验。纯读取、解释原文不需要为交付生成物执行完整核验流程。

局部修改保留未涉及的内容，使用对应 App 的编辑参数创建新任务。result.comparison 提供真实原文件之间的结构对比，右侧工具栏也有入口。涉及修改时可附 comparison.displayMarkdown；保留原件引用以便核对排版。

导入 PPT 的精确修改：先 presentation_inspect 取得 slide、objectId、detail，传 mode=edit、sourcePath、parentId 和 objectEdits。支持 text、fontSize、x/y/w/h（英寸）、fill、tableEdits=[{row,column,text}]（从 1 开始）、imagePath、chartType=bar/line/pie；可加 expectedText 检查目标未变化。例如将第 2 页的折线图改为柱形图，仅修改该图表 objectId 的 chartType。组合对象、外链图表和复合图表会明确拒绝；不要通过重建整份 PPT 绕过保留原版式的要求。

大文件默认先生成 8 页核验图片，原文件和完整 PDF 可先展示。`presentation_verify` 返回 `rendering`、`nextRender`；需要检查其余页面时，用返回的 `nextRender` 参数调用同一工具，或传 `{id,sourceSha256,render:{startPage,count}}`（每批 1–20 页）。先查看该批实际图片，再提交核验记录。超时或中断后可重新查询并续跑；不要重复创建整份文件。`partial` 表示还有页图待生成，不等于生成物损坏。问题可以在右侧核验列表点击定位，继续使用原有局部标注提交修改要求。

## 会话文件归属

通过原生工具执行创作；本次输入副本、产物、预览、源材料和修改版本均属于当前会话 workspace。不要把用户作品写入 App 私有目录。跨会话复用时显式导入文件。用户明确保存为个人模板或技能时，将完整依赖安装到个人库；未安装的模板草稿仍随会话清理。
