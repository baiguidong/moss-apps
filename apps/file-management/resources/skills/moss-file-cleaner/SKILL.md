---
name: moss-file-cleaner
description: 使用 Moss 文件清理 App 扫描重复文件、大文件、相似图片等，读取扫描报告，按确认的范围和策略清理，或排查并重试页面失败任务。通过 App 提供的 CLI 执行，结果与页面任务记录共用。
---

## 调用 CLI

从 Moss 提供的 App Skill 上下文取值。以 `nodeExecutable` 为可执行文件，按顺序传入 `nodeArgs` 中的各项、`cliPath`、`--data-dir`、`dataDir`、子命令及其参数，并应用上下文给出的 `env`。用实际值替换下方占位符，每个路径各占一个参数。通过终端执行时，对含空格或特殊字符的参数按 shell 规则引用。

```text
<nodeExecutable> [nodeArgs...] <cliPath> --data-dir <dataDir> <子命令及参数>
```

| 子命令 | 什么时候用 |
| --- | --- |
| `describe` | 查询当前引擎支持的类别、选项和子命令。 |
| `run --input-file <请求文件绝对路径>` | 提交 UTF-8 JSON 请求，等待任务结束后返回 JSON。长任务可以交给终端后台运行。 |
| `list` | 查找近期页面或 CLI 任务。按目录、类别和时间匹配任务，取得 `id`。 |
| `show <任务ID>` | 查询状态、原始 `input`、已记录的 `argv`、`log` 和产物。 |
| `cancel <任务ID>` | 请求取消任务。用 `show` 确认最终状态，已执行的文件修改需要单独核对。 |

使用上下文给出的 `dataDir`，页面和 CLI 才能看到同一批任务。通过 `list` 和 `show` 读取任务记录。

## 扫描并读取结果

1. 从用户指定的目录开始。`paths` 填已有目录的绝对路径数组。用户给出「看看有多少」「找重复文件」等请求时，先用扫描选项返回候选结果。
2. 按目标选择 `command`。常见类别有 `dup`（重复文件）、`big`（大文件）、`image`（相似图片）、`temp`（临时文件）、`empty-files`（空文件）和 `empty-folders`（空文件夹）。其他类别、可用选项和值以 `describe` 为准。相似视频和视频优化通过文件管理页面或 Agent 工具调用，由 Moss 连接多媒体工坊。
3. 把请求写入临时 JSON 文件，用 `run --input-file` 传入绝对路径。下例按内容哈希找重复文件，包含至少 1 字节的文件。

```json
{
  "command": "dup",
  "paths": ["/absolute/folder"],
  "options": {
    "minimal-file-size": "1",
    "search-method": "HASH"
  }
}
```

`options` 和 `suboptions` 使用 `describe` 中的 `key` 作为字段名。开关用 JSON 布尔值，有值的选项用字符串（包括数字），重复选项用字符串数组。高级参数用 `extraArgs`，每个参数占一个数组元素，保留原始字符。用 `paths` 指定扫描目录，报告路径由 App 生成。

运行后查看 `status` 和 `message`。`succeeded` 表示任务完成，`queued` 或 `running` 时用 `show` 继续查进度。`run` 返回非零退出码时也要读取 stdout 的 JSON，其中可能是带 ID 的任务记录，也可能是校验失败的 `error`。请求超时或结果未拿到时，先用 `list` 和 `show` 核对已有任务，再决定是否重跑。

汇报结果时用 `result.groupCount`、`result.fileCount` 等字段给出摘要。`result.bytes` 是匹配项总大小。估算可释放空间时按实际保留和清理策略计算。需要查看明细时，从 `artifacts` 取扫描报告的实际 `path`。`result.truncated` 为 `true` 时，分段读取报告获取完整明细。

## 执行会修改文件的操作

先明确用户允许处理的目录、文件范围和策略。删除、移动到废纸篓、改名、修复、去除 EXIF、转码或覆盖前，先提供扫描结果。若 `describe` 显示所选操作支持 `dry-run`，预演时保持该操作的选项，并加入 `"dry-run": true`。只要请求含修改选项，CLI 就要求顶层 `"confirmChanges": true`，包括预演。真正修改前核对用户授权，再提交正式请求。

例如，`dup` 的 `"delete-method": "AEO"` 表示每组保留最旧的一份。启用修改策略会按指定目录重新扫描。若授权只覆盖报告中的个别文件，先核对该策略影响的范围是否一致。执行完后用报告和文件状态核验实际结果。

## 排查并重试页面任务

先用 `show` 核对失败任务的 `input`、`argv`、`message` 和 `log`。根据错误修正原始 `input` 中的相关字段，保留其他参数。对可能已经修改部分文件的任务，先核对当前文件状态和剩余范围。确认需要重试后，用新的 JSON 文件执行 `run`，再读取新任务的状态和产物，向用户提供原任务和重试任务的 ID。
