---
name: moss-hyperframes
description: 在 Moss 主会话通过 HyperFrames 工具制作本地 HTML 动画视频。用户需要产品介绍、数据报告、教学讲解、项目汇报视频，或需要修改分镜、场景、渲染并导出 MP4 时使用。
---

# Agent 视频创作

使用 App 提供的独立工具完成创作；将页面作为项目、分镜、任务与视频的预览工作台，不要求用户在页面输入代码，不依赖 API key 或外部模型。

## 工作流

1. **需求**：确认视频主题、受众、用途、风格、画幅、总时长和用户提供的真实材料。缺失信息先简短询问；不要把模板示例数字或文案冒充事实。说明当前流程生成无声的离线动画，旁白字段是脚本，不等于已合成语音。
2. **模板**：调用 `templates.list`，按返回的模板 ID 选择，再调用 `projects.create`，传入 `name/purpose/style/aspectRatio/duration/templateId`。支持 `16:9`、`9:16`、`1:1`，可明确传入整数 `width/height`。
3. **分镜**：调用 `projects.get` 读取项目。使用 `projects.storyboard.save` 保存 `{id,storyboard:{scenes:[{id,title,duration,narration,visual}]}}`，每个场景使用独立稳定 ID，场景数量 1–30，总时长不超过一小时。先向用户展示简洁分镜摘要再按反馈修改。
4. **场景**：逐个调用 `projects.scene.save`，输入 `{id,sceneId,html}`。生成离线 HTML/CSS 片段（不是完整文档），布局填满父容器，标题、正文、图表要清晰可读，正文用中文。使用 CSS animation/keyframes 产生运动；不要写 script、iframe、事件属性、外部 URL、任意 shell 或 FFmpeg 参数。静态资源只使用项目内相对路径或内联 data 图片。旁白和视觉说明不会自动出现在画面中，需要将观众应看到的字幕、标签写入 HTML。每次替换分镜后确保所有新分镜都保存了场景。
   **时间规则**：每个场景的 CSS 动画从该镜头的 **0 秒**开始，App 负责镜头切换。`animation-delay` 仅表示镜头内的延迟，不得累加前序镜头时长。例如分镜为 4+4+4+3 秒时，四个镜头的入场都用 `animation: enter .7s both`，不要分别写 0s/4s/8s/12s；镜头内第二个元素可延迟 `.2s`。CSS 类名和 keyframes 名称使用各镜头专属前缀，避免合成后相互覆盖。检查 `scene.save` 返回的 `warnings` 并修正。
5. **校验**：调用 `projects.validate` 检查已保存分镜和场景，修复缺失或不安全内容。`valid: true` 只表示结构有效，同时检查 `warnings`，尤其是 `ANIMATION_DELAY_OUTSIDE_SCENE`。延迟检查覆盖字面值，不替代 CSS 层叠、动态值和画面验收。若需要引擎级检查，调用 `tasks.start` 的 `operation:"validate"` 并查询结果；不要把结构校验说成已成功渲染。
6. **确认渲染**：向用户汇总视频主题、画幅、时长、主要分镜、无声输出与本地渲染安排，并明确获得用户确认后，再调用 `tasks.start`，传入 `{operation:"render",projectId,fps:30,quality:"balanced"}`。不要只因已创建项目就开始长时间渲染。
7. **轮询与验收**：保存返回任务 ID，用 `tasks.get` 查询；遇到 queued/running 继续合理间隔查询，避免密集循环。`succeeded` 表示编码任务完成，不保证画面正确；交付前抽查每个镜头中段及结尾，确认标题、数字、图表均可见。若仅背景出现，先检查场景内动画是否误用了全片的累计延迟。failed/interrupted/canceled 必须如实说明并根据日志处理。用户要求停止时调用 `tasks.cancel`。
8. **导出**：从成功任务读取真实 `artifacts`，调用 `artifacts.export`，传入 `{id:任务ID,index:0}`，让用户在系统选择器选目标目录。取消导出不算交付完成。回复真实导出路径或产物链接，不编造文件和成功状态。

## 修改已有视频

先调用 `projects.list` 和 `projects.get` 读取现状，仅修改相关分镜或场景；每次修改后重新校验，并重新确认是否渲染。旧版仅有 `html` 的项目仍可读取和渲染；改用分镜时先保存完整 storyboard，再逐个保存场景。
