---
name: moss-pdf
description: 创建、阅读、整理、渲染或填写 PDF 时使用，支持文字提取和离线 OCR。
---

# PDF 创作

## Moss 使用方式

用户在主会话表达需求。读取工具参数说明，由模型填写结构化参数，不要求用户编写代码、HTML 或 JSON。
App 默认全局常驻，无需选择 App。打开 App 只显示宿主通用信息与设置；不要引导用户去独立工作台完成任务。
提交任务后查询到 succeeded 才能交付。调用 moss_present(result.presentation) 在右侧展示，并在回复使用 result.displayMarkdown。需要下载时提供 result.downloads 中的原始文件资源链接，导出到本地目录使用对应 export 工具。
修改生成新任务，能传 parentId 时传原任务 ID，保留旧文件。先读取原任务 input 或参考文件，保留用户未要求改变的内容。整份修改在主会话表达，预览中的局部修改复用 Moss 标注，不创建整体“继续修改”按钮。
遵循用户指定的模板、格式和输出数量。生成后检查内容、可编辑性和预览；内容预览不能证明 Office 原生排版完全一致。发现不支持的功能应说明，不用截图替换可编辑的文档、单元格或图表。

## 工具与操作

pdf_import 导入绝对路径，pdf_list 查看文件 ID、页数、表单字段及任务。pdf_create 接收 fileIds 和 options，pdf_status 查询任务，pdf_export 导出结果。
创建文字 PDF：title 与 options={mode:"create",content:"正文"}，无需 fileIds。复杂图文报告使用文档 App 的 PDF 创作，再在此 App 检查。
页面操作：arrange 合并/重排/删除/旋转，split 拆分，extract 提取文字，ocr 识别扫描件，render 把每页渲染成 PNG。pages 使用 fileId、从 0 开始的 page、rotation。
表单：mode=form，fields 按 metadata.fields 的准确名称填写；默认保留交互字段，只有用户明确要求才 flatten。完成后再次读取字段与页图，核对字段值和可见外观，不能把“看起来填了”当作逻辑字段写入成功。
原 PDF 不修改；拒绝猜测不存在的字段、未授权的签名或数据。提取文字不能替代版面检查。检查文字裁切、重叠、表格、页码与中文字体，扫描识别不确定的内容要标明。

适配范围与原始插件版本见 [adaptation.md](references/adaptation.md)。

## 原文引用与核验记录

pdf_inspect({id,page}) 读取已生成 PDF 的原文和 citation.displayMarkdown；分析时复用这些真实引用，点击会在主会话右侧定位页面。扫描件没有文字层时先使用 OCR 或查看页图，不编造原文。

pdf_status 的 result.visualReview 返回真实页图；逐页查看后调用 pdf_verify，传 id、sourceSha256、pages=[{page,observations,issues:[{severity,message}]}] 记录观察，无问题时 issues=[]。支持分批，缺页保持待核验；错误保持待修复。修复时创建带 parentId 的新任务，再检查新文件，最多连续修复 3 轮，不能以渲染成功代替视觉检查。纯阅读无需执行生成物的完整核验。result.comparison 提供修改前后文字对比，具体版式仍需查看实际页面。

大文件默认先生成 8 页核验图片，原文件和完整 PDF 可先展示。`pdf_verify` 返回 `rendering`、`nextRender`；需要检查其余页面时，用返回的 `nextRender` 参数调用同一工具，或传 `{id,sourceSha256,render:{startPage,count}}`（每批 1–20 页）。先查看该批实际图片，再提交核验记录。超时或中断后可重新查询并续跑；不要重复创建整份文件。`partial` 表示还有页图待生成，不等于生成物损坏。问题可以在右侧核验列表点击定位，继续使用原有局部标注提交修改要求。

## 会话文件归属

通过原生工具执行创作；本次输入副本、产物、预览、源材料和修改版本均属于当前会话 workspace。不要把用户作品写入 App 私有目录。跨会话复用时显式导入文件。用户明确保存为个人模板或技能时，将完整依赖安装到个人库；未安装的模板草稿仍随会话清理。
