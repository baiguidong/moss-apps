---
name: moss-document-converter
description: 使用 Moss 文档格式转换 App 的受管 Pandoc CLI 处理本地任务，查看 UI 失败记录、修正参数并将结果保存在 Moss 中。
---

使用 App skill 上下文给出的 `cliPath` 和 `dataDir`，通过上下文的 `nodeExecutable`（含 `nodeArgs` 和 `env`）执行 CLI。下文 `node` 表示这个受管 Node 可执行文件，无需用户另装 Node。不要猜安装路径或直接修改工作区记录。基础功能无需调用大模型，也不依赖页面是否可用。

将用户请求写为 UTF-8 JSON 文件，再用参数数组调用：

```text
node <cliPath> --data-dir <dataDir> describe
node <cliPath> --data-dir <dataDir> run --input-file <absolute-request.json>
node <cliPath> --data-dir <dataDir> list
node <cliPath> --data-dir <dataDir> show <task-id>
node <cliPath> --data-dir <dataDir> cancel <task-id>
```

`run` 等待完成并输出 JSON，失败返回非零退出码；长任务可使用终端的后台执行机制，随后查询任务。每次运行创建独立记录，页面自动读取。不要把任务 ID 当作已成功；读取 `status`、`message` 和真实 `artifacts`。

请求示例：

```json
{"paths":["/absolute/input.md"],"from":"markdown","to":"docx","options":{"toc":true}}
```

`describe` 返回固定版本支持的参数和格式；参数名以该输出为准。选项放在 `options` 中，布尔开关使用布尔值，有值的选项使用字符串，重复选项使用字符串数组。`extraArgs` 是独立参数组成的数组，不是 shell 命令，不给数组元素添加 shell 引号。输入路径必须是绝对路径，空格、中文与引号保留为路径内容。

修复页面失败任务时先 `show`，核对原始 `input`、实际 `argv`、错误和日志。只修改与错误有关的字段，用新 JSON 文件重新 `run`；成功后回读实际产物，记录新旧任务 ID。用户已完成且无须重做的任务不自动重跑。需要修改 App 页面源码时走现有 App 迭代入口；此 skill 提供功能调用和诊断，不擅自修改安装包。

设置 `mode: "batch"` 分别转换多个文件；`mode: "merge"` 或省略时按顺序合并。批处理部分失败返回 `status: "partial"` 和每个文件的结果。输出由 App 放入任务目录并登记；不要用高级参数覆盖输出路径。PDF 需要额外 PDF 引擎，HTML 内容预览不等于 Office 精确分页排版。

查询格式或模板无需输入文件：`{"mode":"inspect","query":"print-default-template","value":"html5"}`。可查询 `list-input-formats`、`list-output-formats`、`list-extensions`、`list-highlight-languages`、`list-highlight-styles`、`print-default-template`、`print-default-data-file`、`print-highlight-style`、`help`、`version`。
