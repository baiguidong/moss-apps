---
name: moss-templates
description: 用户要求把参考文档、表格、PPT、图片或文本保存为可重复使用的模板，或修改、应用已有模板时使用。一次性文件创作使用对应 App。
---

# 模板创建与复用

## Moss 使用方式

用户在主会话表达需求。读取工具参数说明，由模型填写结构化参数，不要求用户编写代码、HTML 或 JSON。
App 默认全局常驻，无需选择 App。打开 App 只显示宿主通用信息与设置；不要引导用户去独立工作台完成任务。
提交任务后查询到 succeeded 才能交付。调用 moss_present(result.presentation) 在右侧展示，并在回复使用 result.displayMarkdown。需要下载时提供 result.downloads 中的原始文件资源链接，导出到本地目录使用对应 export 工具。
修改生成新任务，能传 parentId 时传原任务 ID，保留旧文件。先读取原任务 input 或参考文件，保留用户未要求改变的内容。整份修改在主会话表达，预览中的局部修改复用 Moss 标注，不创建整体“继续修改”按钮。
遵循用户指定的模板、格式和输出数量。生成后检查内容、可编辑性和预览；内容预览不能证明 Office 原生排版完全一致。发现不支持的功能应说明，不用截图替换可编辑的文档、单元格或图表。

## 保存、更新与应用

template_guide 返回完整参数。template_create 提交任务，template_status 查询，template_list 查历史，template_read 读模板说明，template_export 导出。
保存：mode=save、title，以及 sourcePath 或 content；instructions 写清用途、结构、风格和必须保留的部分。参考文件复制入 App，原文件不修改。
文本占位符使用 {{变量名}}。应用：mode=use、templateId、values；未填写的占位符会报错。Office 模板应用保留参考文件，并返回 referencePath、nextApp 和变量说明，由模型交给文档/表格/演示文稿 App 生成新内容，不把仅复制参考文件说成已完成新作品。
更新：mode=update、templateId、parentId=templateId，按需传新 sourcePath/content/instructions，保留旧版本。不要把一次性输出自动存为用户模板。
只有模板确实保存、结果可读取并且预览有内容时才能报成功。模板名称和说明面向用途，不记录本机临时路径、账号凭据或来源中无关的私人数据。云文档链接需要先通过用户连接读取，不能在未取得参考内容时声称完成模板。

适配范围与原始插件版本见 [adaptation.md](references/adaptation.md)。

## 实际页面核验

Office 结果优先展示原文件，右侧由 Moss 渲染实际页面；不要用内容 HTML 替代真实版式。result.visualReview 返回渲染状态、pageCount、pdfPath 和 pages[].path。只有 status=rendered 表示全部页面图片已生成，visuallyVerified=false 表示仍须模型逐页查看；不能把渲染成功说成视觉核验完成。查看图片，检查溢出、重叠、中文字体、表格和分页，有问题修改原生内容后重新生成、重新查看。表格还需检查公式、格式和数值。

若状态 unavailable / failed / pdf-only / partial，如实说明缺少的核验步骤。Office 需要本机 LibreOffice，逐页 PNG 需要 Poppler（pdftoppm/pdfinfo）；也可将已有 pdfPath 交给 PDF App 的 render 模式生成图片。不要把缺失依赖的结果称为排版已验证。原文件与页面预览均可在主会话重新打开，支持页码、缩略图、缩放和局部标注。

## 保存为个人技能

用户要求保存为可复用模板时，默认完成个人技能安装。由模型填写具体的 skillName（小写英文、数字和连字符）和 skillDescription（明确触发用途）。save/update 返回 result.skillBundle，包含本次生成的可移植技能目录和 ZIP；installed=false 表示还未安装，不能提前报告技能已生效。

读取内置 skill-installer，先 inspect --source result.skillBundle.path，审阅说明和资源，再以返回 digest 安装至 Moss 个人 skills 目录。授权已包含在用户的模板保存请求中，无需重复请求确认。检查安装结果和 SKILL.md，确认技能列表可发现后再报告完成。不要仅生成 ZIP 就结束。用户仅要导出技能包时尊重其范围。

更新沿用原技能名。使用安装器既有的更新流程：比较现有个人技能，保留用户本地修改，将旧版备份至 skills 目录外，安装失败恢复；不得直接覆盖或删除用户修改。App 的旧任务和参考文件仍然保留。mode=use 只生成应用结果，不再次安装技能。

## 会话文件归属

通过原生工具执行创作；本次输入副本、产物、预览、源材料和修改版本均属于当前会话 workspace。不要把用户作品写入 App 私有目录。跨会话复用时显式导入文件。用户明确保存为个人模板或技能时，将完整依赖安装到个人库；未安装的模板草稿仍随会话清理。
