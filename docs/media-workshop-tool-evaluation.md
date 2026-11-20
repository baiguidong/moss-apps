# 音视频工坊工具选用实测

## 0.3.1 安装包验证

使用 Apple Silicon 安装包中的 7 个工具定义，对 `gpt-6.1-sol` 重新测试。原来的 25 题从 23/25 提高到 **25/25**，9 道定向题从 5/9 提高到 **9/9**。两组有 5 题重合，本轮共运行 **29 个不同场景**，每题独立运行一次。

遇到分镜动画的单独试听请求时，模型说明只有口播项目支持试听。项目类型未知时，它先查项目再回答。查询工坊自带的 FFmpeg 或 ffprobe 版本时，它能说明会话工具的范围。对法语采访的字幕导出请求，它依次转写、查询产物、导出 SRT。上述评分使用真实模型调用和模拟任务结果。

在仓库根目录用以下命令验证打包产物。

```sh
node scripts/media-tools-eval/run.mjs --moss-text --verify --app-dir artifacts/moss.media-tools/0.3.1/package-darwin-arm64 > tool-verification.json
```

## 0.3.0 名称与参数说明对照实验

2026-11-20，用本机 Moss 文本模型配置中的 `gpt-6.1-sol` 做真实函数调用测试。当前 7 个工具和仅改名的 7 个工具在同一组 25 道中文题上均通过 **23/25**。主要误判发生在项目类型和输出类型的组合，以及旧工具曾提供、当前工具没有暴露的能力。

## 原来的 26 个工具去了哪里

原名取自仓库提交 `e49fc22` 的三个 manifest。下表使用 App 内的工具 ID。Moss 给这些 App 的模型工具名加前缀，例如合并后的 `media_get` 在请求中实际是 `mediatools_media_get`。

| 原 App | 原工具 | 原用途 | 在工坊 0.3.0 中怎么做 |
| --- | --- | --- | --- |
| 音视频工坊 0.2.0 | `run` | 查媒体信息、剪辑、转换、执行 FFmpeg 参数 | `media_edit`，用 `mode` 选择操作 |
| 同上 | `task` | 查单个任务状态和结果 | `media_get(type=task)` |
| 同上 | `catalog` | 查引擎版本和支持的操作 | 操作在 `media_edit.mode` 枚举中。引擎版本可通过工坊 CLI 的 `describe` 查询，7 个会话工具没有这个查询入口 |
| 同上 | `list` | 列近期媒体任务 | `media_get(type=tasks)` |
| 同上 | `cancel` | 取消媒体任务 | `media_cancel` |
| 同上 | `read-result` | 读任务生成的文本或 JSON | `media_get(type=artifact)`，传任务 ID 和产物序号 |
| 同上 | `studio` | 查口播角色、音色、项目和导出规格 | `media_get(type=settings)` |
| 同上 | `project-create` | 新建口播项目 | `video_project_save(kind=avatar, fields=…)` |
| 同上 | `project-get` | 读口播讲稿、版本和设置 | `media_get(type=project)` |
| 同上 | `project-save` | 更新已有口播项目 | `video_project_save`，传 `id`、`version` 和 `fields` |
| 同上 | `speech` | 为已保存的口播稿生成试听音轨 | `video_render(output=speech)` |
| 同上 | `render` | 提交口播 MP4 录制 | `video_render`，传项目 ID 和版本 |
| 语音转写 0.1.4 | `files_import` | 把文件复制进素材库，得到文件 ID | 转写直接给 `media_transcribe` 本地路径。仅导入、稍后处理仍可在转写页面操作 |
| 同上 | `workspace_get` | 列已导入素材、任务和结果 | 任务和产物由 `media_get` 查询。已导入素材完整清单在页面中可见 |
| 同上 | `tasks_start` | 按已导入文件 ID 发起转写 | `media_transcribe(path, language)` |
| HyperFrames 0.3.9 | `templates-list` | 列模板名称、用途和默认镜头标题 | `video_project_save.animation.templateId` 枚举列出 4 个 ID，分镜页面可选模板。会话工具无法读取原模板详情列表 |
| 同上 | `projects-create` | 按模板新建分镜项目 | `video_project_save(kind=animation, animation=…)` |
| 同上 | `projects-get` | 读分镜和场景代码 | `media_get(type=project)` |
| 同上 | `projects-list` | 列分镜项目 | `media_get(type=projects)`，结果同时包含口播和分镜项目 |
| 同上 | `storyboard-save` | 保存完整的镜头表 | `video_project_save`，传 `id`、`version` 和完整 `storyboard` |
| 同上 | `scene-save` | 更新一个镜头的场景代码 | `video_project_save`，传 `id`、`version`、`sceneId`、`html` |
| 同上 | `projects-validate` | 检查分镜结构、场景和时间警告 | `media_get(type=validate)` |
| 同上 | `tasks-start` | 提交渲染或 HyperFrames 引擎校验任务 | 成片用 `video_render`。结构检查用 `media_get(type=validate)`。原先单独提交引擎校验作业的入口没有暴露 |
| 同上 | `tasks-get` | 查渲染状态、日志和产物 | `media_get(type=task)` |
| 同上 | `tasks-cancel` | 取消渲染任务 | `media_cancel` |
| 同上 | `artifacts-export` | 将已生成的文件导出到所选目录 | `media_export`，传任务 ID 和从 0 开始的产物序号 |

这三个 App 原先都用自己的后台 action 实现工具，清单来自各自的 `contributes.tools`。[合并版工具清单](../apps/media-tools/app.moss.json) · [后台参数校验与分发](../apps/media-tools/src/backend/workshop.mjs)

## AI 实测

每题单独开启上下文，模型自行决定调用、回答或追问。请求只提供这 7 个工具的真实运行时名称、描述和 JSON Schema。评测排除了仓库文件、工坊 skill、其他 App 的工具和路由示例。对照组只替换名称，其他输入相同。

| 同一组中文任务 | 0.3.0 当前名称 | 仅替换为动词开头的名称 |
| --- | ---: | ---: |
| 23 道工具选择与参数题，含缺文件、分镜试听两道边界题 | 22/23 | 22/23 |
| 2 道旧能力边界题，查版本、只导入素材 | 1/2 | 1/2 |
| 合计 | **23/25** | **23/25** |

改名组依次使用 `process_media_file`、`transcribe_media_file`、`save_video_project`、`render_video_project`、`query_workshop`、`cancel_task` 和 `export_task_file`。两组在同两题失分。

- **“把法语采访做成 SRT，再存到我选的目录。”** 两组都先转写，再查任务产物，找到实际排在第 5 个的 SRT，并用 `index=4` 导出。
- **“把这个口播项目的讲稿改成‘下午好。’”** 题目没给版本。两组都先读取项目，再用工具返回的版本保存。修改第二个镜头时，也都保留了第一个镜头和原文案。
- **“给这个分镜动画项目直接试听数字人配音。”** 两组都对动画项目调用了 `video_render(output=speech)`。该组合能通过普通 JSON 类型检查，实际后台只接受口播项目。
- **“查工坊实际安装的 FFmpeg 和 ffprobe 版本。”** 两组最后都尝试了 `media_edit(mode=raw)`。这个操作要求 FFmpeg 实际生成输出文件，无法用一条版本查询返回这两个版本。

### 保留名称，把参数说明写清楚

针对两个误判，只在评测中修改三处说明。明确 `video_render.output=speech` 仅支持口播，明确 `media_get(type=settings)` 返回哪些设置，并说明 `media_edit(mode=raw)` 需要生成文件。复测包括两道原失分题、四种新问法，以及口播试听、动画渲染、查询媒体信息三道正向对照。[候选说明与复测题](../scripts/media-tools-eval/followup.mjs)

| 9 道定向复测 | 当前说明 | 原名加候选说明 |
| --- | ---: | ---: |
| 分镜试听及查版本的 6 种问法 | 2/6 | 6/6 |
| 3 项原有可执行操作 | 3/3 | 3/3 |
| 合计 | **5/9** | **9/9** |

9/9 衡量工具决策、参数以及能否说明限制。其中一条回答还推测生成视频时能包含旁白，测试没有验证该说法。查版本时，终端 PATH 上的命令也不能证明工坊随包引擎的版本。定向题专门覆盖先前的错误，分数不能当作日常使用准确率。

### 测量范围和复跑

使用了真实的模型函数调用。需要下一轮决策时，脚本返回固定的模拟项目、版本和任务结果，检查后续调用是否使用了对应字段。评分检查工具名、JSON Schema、业务关键参数、调用顺序和需要追问时的回答。模拟任务直接返回成功，因此这里测量的是已加载工具的选用，Moss 工具发现、实际渲染质量、长任务等待和用户打开的其他工具不在测量范围内。每题每组一次，单一模型。网络失败的请求做了重试。

在仓库根目录用 0.3.0 工具定义复跑历史对照实验。以下命令使用本机 Moss 文本模型配置，也可以通过 `EVAL_BASE_URL`、`EVAL_API_KEY`、`EVAL_MODEL` 指定其他兼容端点并去掉 `--moss-text`。测试只发送工具定义和合成用例。

```sh
node scripts/media-tools-eval/run.mjs --moss-text --app-dir artifacts/moss.media-tools/0.3.0/package-darwin-arm64 > tool-evaluation.json
node scripts/media-tools-eval/run.mjs --moss-text --followup --app-dir artifacts/moss.media-tools/0.3.0/package-darwin-arm64 > tool-evaluation-followup.json
```

[25 道测试题](../scripts/media-tools-eval/cases.mjs) · [调用与评分脚本](../scripts/media-tools-eval/run.mjs)
