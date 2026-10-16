---
name: moss-file-cleaner
description: 使用 Moss 文件清理 App 的受管 Czkawka CLI 处理本地任务，查看 UI 失败记录、修正参数并将结果保存在 Moss 中。
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
{"command":"dup","paths":["/absolute/folder"],"options":{"minimal-file-size":"1","search-method":"HASH"}}
```

`describe` 返回固定版本支持的参数和格式；参数名以该输出为准。选项放在 `options` 中，布尔开关使用布尔值，有值的选项使用字符串，重复选项使用字符串数组。`extraArgs` 是独立参数组成的数组，不是 shell 命令，不给数组元素添加 shell 引号。输入路径必须是绝对路径，空格、中文与引号保留为路径内容。

修复页面失败任务时先 `show`，核对原始 `input`、实际 `argv`、错误和日志。只修改与错误有关的字段，用新 JSON 文件重新 `run`；成功后回读实际产物，记录新旧任务 ID。用户已完成且无须重做的任务不自动重跑。需要修改 App 页面源码时走现有 App 迭代入口；此 skill 提供功能调用和诊断，不擅自修改安装包。

覆盖全部扫描类别。`video-optimizer` 另外填写 `subcommand`（`transcode` 或 `crop`）与 `suboptions`。扫描默认不修改原文件；删除、修复、改名等选项应与用户授权范围一致，执行修改时显式填写 `confirmChanges: true`。使用上游支持的 dry-run 检查范围；不要在未经授权的目录重试修改操作。视频功能会自动准备固定版本的 FFmpeg / ffprobe。返回的大小是匹配文件总大小，不等于可释放空间。
