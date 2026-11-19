# 音视频工坊

在「口播」输入讲稿或导入授权配音，选择角色、画幅和镜头。可换背景、开关字幕，按 720p 或 480p / 24 fps 导出 MP4。在任务里预览或导出到指定文件夹。单个项目支持 10 分钟音轨，录制期间保持窗口可见。系统音色用于个人非商业项目。

原创角色小墨由 scripts/avatar.mjs 构建。TalkingHead、HeadAudio、Three.js 和口型参数随包提供，许可见 assets/licenses。自有角色需符合 TalkingHead 骨架和 Oculus 口型规范，并内嵌纹理。安装同一版本的 ZIP 后，导入配音、口型和编码均可离线运行。

「让 Moss 写讲稿」准备主会话草稿。选择工坊后 Agent 可以按项目版本修改稿件和提交渲染。对话使用 Moss 已配置的模型，离线回复需要本机模型。「语音转写」是独立可选 App，启用并授权后支持配音字幕及按住说话。

Moss App 使用随包提供的 FFmpeg 和 ffprobe。页面可读取并预览媒体，裁剪、压缩、提取 WAV 音频、生成 GIF、转换为 MP4，查看结果并导出。Agent 通过随包 CLI skill 可使用完整 FFmpeg 参数；任务和页面共享。原始输入保持不变，产物保存在 App 任务目录。

当前发行包支持 macOS Apple Silicon。浏览器播放器支持的编码格式可能少于 FFmpeg，无法直接预览时仍可运行处理任务并导出结果。二进制的许可按实际构建配置和包内说明确定。

开发：bun run --cwd apps/media-tools check / test / build；从仓库根目录使用 node scripts/package-app.mjs --app moss.media-tools 打包。
