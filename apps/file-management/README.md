# 文件管理

从 Moss「更多 → 文件管理」打开。在「文件清理」中用 Czkawka 扫描重复文件、大文件、相似图片等，按所选策略处理。在「备份与恢复」中用 Restic 初始化加密备份库、备份目录、查看快照、恢复文件或校验备份库。两个页面共用任务后端，页面和 Agent 共用任务 ID、状态和报告。

选择扫描类型和目录即可开始，分组结果支持按文件名或路径筛选，相似图片可并排比较或放大。可在结果中勾选要移入系统废纸篓的文件，确认页列出本次选择。清理时会跳过扫描后发生变化的文件，处理记录逐项显示结果。旧记录可按原设置重新扫描，以启用勾选操作。

扩展名、文件名、拍摄信息和视频优化的处理按钮位于扫描结果上方。确认目录后，引擎按原规则重新扫描并处理匹配项。拍摄信息和视频处理默认生成副本。命令行参数位于高级设置，原始报告和日志位于任务详情。废纸篓操作使用 macOS 的系统 `trash` 命令或 Linux 的 `gio trash`。

备份时选择备份库和源目录。恢复时按时间与来源选择快照，可先查看文件，再选择恢复目录。恢复页面默认保留已有的同名文件，可显式勾选覆盖。

支持 macOS Apple Silicon 和 Linux x64，要求 Moss Host API 3.21 或更新的兼容版本。安装包携带 Czkawka 和 Restic。后台按需启动，通过 Host 活动续约保活排队中和运行中的任务，空闲后可回收。备份密码由 Moss 凭据库管理，仅备份任务的进程使用它。恢复可能覆盖目标目录中的同名文件。

相似视频和视频优化需要安装并启用多媒体工坊（`moss.media-studio`）0.1.1 或兼容版本，通过 Moss 的跨 App 接口复用其经过校验的 FFmpeg 和 ffprobe。缺少工坊时，页面提示安装，Agent 提交视频任务也会收到同样的提示。常规清理和备份可单独安装后离线使用。

## 从旧 App 迁移

- 文件管理使用独立 ID `moss.file-management`。在任一页的「任务记录」点「导入旧任务」，可复制原「备份与恢复」和「文件清理」默认实例的已结束任务与报告，保留任务 ID。旧任务结束后可再次导入。
- 已有 Restic 备份库可直接使用。选择原备份库目录，并在文件管理中重新保存原密码。密码由 Moss 按 App 实例保存。
- 应用市场在文件管理首版发布后隐藏 `moss.backup` 和 `moss.file-cleaner`。已安装的旧 App 和原备份文件可继续访问。Agent 会话可选择新 App 并使用 `filemanagement_` 工具。

## 给 Agent 的工具

| 工具 | 用途 |
| --- | --- |
| `filemanagement_cleanup_scan` | 扫描指定本地目录，返回任务 ID。默认扫描可使用 `dup`、`big`、`image` 等类别。 |
| `filemanagement_cleanup_run` | 按用户确认的目录和策略执行清理、改名、修复或优化。传入 `confirmChanges: true`。支持预演的操作可用 `dry-run`，正式执行会重新扫描。 |
| `filemanagement_run` | 提交初始化、备份、列出快照或文件、恢复和校验任务。高级 Restic 参数继续使用 `command: raw`。 |
| `filemanagement_task` | 按 `id` 获取扫描、清理或备份任务的状态、参数、日志和产物。长任务提交一次，之后按 ID 查询。 |
| `filemanagement_catalog` | 查看备份操作和清理类别。传入 `cleanupCommand` 可获取指定清理类别的选项。 |
| `filemanagement_list` | 查看近期任务，包含页面与 Agent 发起的任务。 |
| `filemanagement_cancel` | 请求取消任务，之后可用 `filemanagement_task` 核对最终状态。 |
| `filemanagement_read-result` | 按任务 ID 和产物序号读取文本或 JSON 报告，单文件最大 2 MiB。 |

例如用 `filemanagement_cleanup_scan` 查找重复文件，传入 `{"command":"dup","paths":["/absolute/folder"],"options":{"minimal-file-size":"1","search-method":"HASH"}}`。读取任务的 `result.fileCount` 和报告后，再根据用户要求决定是否执行清理。`result.bytes` 是匹配项总大小，估算释放空间时要按实际保留策略计算。

## 开发验证

在仓库根目录执行 `bun run --cwd apps/file-management check`、`bun run --cwd apps/file-management test`，然后运行 `node scripts/package-app.mjs --app moss.file-management`。对生成的本机平台包运行 `node scripts/verify-bundled-apps.mjs --app moss.file-management` 验证真实扫描、备份和恢复。

引擎来源见 [Czkawka 12.0.2](https://github.com/qarmin/czkawka/releases/tag/12.0.2) 和 [Restic 0.19.1](https://github.com/restic/restic/releases/tag/v0.19.1)。
