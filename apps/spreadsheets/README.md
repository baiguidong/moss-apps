# 表格

在主会话中创建、读取和修改 Excel 表格，计算公式并预览数据。

默认全局常驻。App 无独立工作台；技能与工具供主会话使用。通过资源引用预览，修改生成新版本，源文件与导出文件保存在 App 数据目录。

交互表格预览使用 TanStack Table Core 8.21.3，支持按实际数值排序、搜索格式化内容、分页、列显隐、工作表切换和重置视图。状态按工作表保存并与 Moss 另一处预览同步；原行号和公式提示保留，操作不改写 XLSX。原文件仍是主成果，`result.interactivePreview` 与 `result.displayMarkdown` 提供交互预览入口。

预览数据共享约 900 KiB 的预算；超过时显示实际载入行数，并说明搜索、排序范围。完整数据仍在 XLSX 和工作簿 JSON 中；没有 JavaScript 时显示前 25 行、40 列作为静态回退。运行包不包含 React、浏览器运行时或新服务，HTML 带完整脚本及 MIT 许可，可离线打开。

验证：`bun run --cwd apps/spreadsheets test`、`bun run --cwd apps/spreadsheets test:preview`（后者需要 Playwright Chromium）。
