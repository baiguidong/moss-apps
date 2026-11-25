---
name: moss-spreadsheets
description: 创建、分析、读取或修改本地 XLSX、CSV、TSV 的数据、公式、格式和图表时使用。此 App 不控制正在运行的 Excel。
---

# 表格创作

## Moss 使用方式

用户在主会话表达需求。读取工具参数说明，由模型填写结构化参数，不要求用户编写代码、HTML 或 JSON。
App 默认全局常驻，无需选择 App。用户可在工作簿预览中选择「编辑工作簿」。
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
工作簿通过 XLSX 预览交付。需要引用单元格时，使用 spreadsheet_inspect({id,sheet,range})，复用返回的 citation.displayMarkdown。工作簿的修改对比见 result.comparison。

适配范围与原始插件版本见 [adaptation.md](references/adaptation.md)。

## 会话文件归属

通过原生工具执行创作；本次输入副本、产物、预览、源材料和修改版本均属于当前会话 workspace。不要把用户作品写入 App 私有目录。跨会话复用时显式导入文件。用户明确保存为个人模板或技能时，将完整依赖安装到个人库；未安装的模板草稿仍随会话清理。
