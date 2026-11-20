# 音视频工坊

在一个 Moss App 中剪辑音视频、校对字幕、制作分镜动画和数字人口播。顶部切换工作区，原有转写页保留波形、逐句播放、文字校对和 TXT/SRT/VTT 导出，分镜页保留示例、主会话创作、镜头编辑、校验和渲染。口播按原流程在可见预览中录制。任务页显示同一工坊内提交的作业。

Apple Silicon 版本随包提供 FFmpeg、ffprobe、Whisper 多语言 base 模型、角色素材和 HyperFrames。分镜渲染需要本机 Chromium/Chrome。剪辑、转写和动画通过同一按需 Node 后端、同一工作队列执行。模型和渲染引擎在对应作业中加载。口播系统音色用于个人非商业项目。

## 会话工具

工坊采用会话范围。选中工坊后可用七个工具。

| 工具 | 输入与结果 |
| --- | --- |
| `media_edit` | `mode`、本地 `path` 及剪辑参数。例如 `trim` 使用以秒计的 `start` 与 `end`。高级模式 `raw` 的 FFmpeg 参数必须实际生成 `{output}` 文件。返回任务 ID。 |
| `media_transcribe` | 本地 `path` 和可选 `language`（默认 `auto`）。返回任务 ID。 |
| `video_project_save` | 新建传 `kind=avatar` 与 `fields`，或 `kind=animation` 与 `animation`。修改传 `id`、`version` 和项目字段、完整 `storyboard` 或 `sceneId` 与 `html`。 |
| `video_render` | 传 `id` 和 `version`。默认生成 MP4 并返回任务 ID。分镜动画只支持成片。数字人口播也支持 `output=speech`，直接返回试听音轨。 |
| `media_get` | 按 `type` 读取任务、项目、文本产物或历史。文本产物还需 `index`。`settings` 列出口播角色、音色、画幅和画质，`validate` 检查分镜结构。 |
| `media_cancel` | 按任务 `id` 取消。 |
| `media_export` | 按任务 `id` 和产物 `index` 导出到所选目录。 |

查询工坊随包的 FFmpeg 和 ffprobe 版本，使用工坊 CLI 的 `describe` 命令。

原音视频工坊升级沿用 App ID、口播项目和媒体任务。独立语音转写、HyperFrames 的历史资料仍由原 App 管理。新任务可直接在工坊完成，只选择音视频工坊即可获得上述七个工具。Linux 用户可继续使用独立语音转写 App。
