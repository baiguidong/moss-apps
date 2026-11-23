# 多媒体工坊

`moss.media-studio` 是图片、音视频和视频创作的本地工作区。需要 Moss Host API 3.24，分别提供 macOS Apple Silicon 与 Linux AMD64 安装包。

首页「工作台」按媒体工具和内容创作分组，点击最近任务可继续查看结果。「任务中心」汇集图片、音视频、转写、分镜和口播任务，支持按类型和状态筛选、按文件名或操作搜索。打开图片结果可对比原图，也可以直接批量导出。

- **图片处理**支持批量格式转换与压缩、缩放、拖拽裁剪、旋转镜像、调色、降噪、文字水印、元数据处理、结果对比和导出。支持静态 JPEG、PNG、WebP、AVIF、TIFF，每批最多 50 张。
- **音视频处理**支持读取媒体信息、裁剪、压缩、提取 WAV、生成 GIF、转码 MP4 和高级 FFmpeg 参数。工作台可设置 GIF 宽度与帧率，也可直接对已选媒体生成字幕。
- **转写字幕**使用随包的 Whisper 多语言 base 模型，支持逐句播放、校对和导出 TXT、SRT、VTT。Linux 使用 CPU。
- **分镜动画、数字人口播和角色对话**复用音视频工坊的编辑器。分镜渲染需要目标主机安装 Chromium 或 Google Chrome。口播录制需要打开项目预览。macOS 使用系统音色，Linux 使用随包的 Melo 中文音色。两个平台均可导入已有配音。角色对话继续使用 Moss 中配置的模型。

桌面可用导航顶部按钮收起或展开工作区。分镜页顶部可切换项目，点「新建视频」设置名称、模板、画幅和时长，点「创作工作台」返回分镜首页。在窄窗口的任务中心点一条记录查看详情，点「返回任务列表」继续浏览。

## 在主会话中使用

选中多媒体工坊后可用 12 个工具。图片页和 Agent 共用图片工作区，可在「任务中心」查看页面和会话发起的任务。

| 工具 | 用途 |
| --- | --- |
| `image_import` | 导入本地静态图片，返回文件 ID |
| `image_get` | 查看图片、任务进度与结果文件 ID |
| `image_process` | 按 `fileIds` 批量应用 `options` 中的裁剪、压缩、水印等设置 |
| `image_cancel` | 取消图片处理任务 |
| `image_export` | 按结果文件 ID 保存到所选目录 |
| `media_edit` | 查询媒体信息，剪辑或转换已有音视频 |
| `media_transcribe` | 提交本地音视频转写 |
| `video_project_save` | 创建或更新口播及分镜项目 |
| `video_render` | 提交视频渲染。口播也支持 `output=speech` 试听 |
| `media_get` | 查任务、项目和文本产物，查看设置或检查分镜结构 |
| `media_cancel` | 取消音视频、转写或渲染任务 |
| `media_export` | 按任务 ID 和产物序号导出 |

## 从旧 App 导入

打开「更多 → 多媒体工坊」，点「导入旧记录」，选择旧 App 的实例数据目录。图片实例目录包含 `workspace.json`，音视频工坊实例目录包含 `jobs` 或 `studio`。通常位于 Moss 数据目录下的 `apps-data/<旧 App ID>/instances/<实例 ID>`，也可从其备份副本导入。每个实例分别选择一次。

图片迁移包含原件、结果、预览和批处理记录。音视频迁移包含工坊任务与产物、口播项目和素材、角色对话记录、分镜项目及工作区里导入的转写素材。导入保留已有 ID，重复导入会跳过重复记录。未完成的旧任务会显示为「已中断」，可按需要重新发起。旧任务中引用实例目录外的文件时，请保留原件并在需要时重新选择。打开迁入项目时使用新工坊的项目链接。

## 平台验证

Linux AMD64 使用 glibc，Whisper CPU 需要 `libgomp1`。使用云电脑时，文件选择和导出依赖目标 Moss Web Host 提供相应界面。中文水印和分镜需要目标主机有可用中文字体。

从仓库根目录运行：

```sh
bun run --cwd apps/media-studio check
bun run --cwd apps/media-studio test
bun run --cwd apps/media-studio build
node scripts/verify-media-studio.mjs
node scripts/verify-media-studio-layout.mjs
node scripts/package-app.mjs --app moss.media-studio
```

正式发布工作流在各目标平台使用签名包执行图片转换、音视频处理、Whisper 转写、口播配音和分镜渲染。
