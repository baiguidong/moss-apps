# 音视频工坊

Moss App 使用随包提供的 FFmpeg 和 ffprobe。页面可读取并预览媒体，裁剪、压缩、提取 WAV 音频、生成 GIF、转换为 MP4，查看结果并导出。Agent 通过随包 CLI skill 可使用完整 FFmpeg 参数；任务和页面共享。原始输入保持不变，产物保存在 App 任务目录。

当前发行包支持 macOS Apple Silicon。浏览器播放器支持的编码格式可能少于 FFmpeg，无法直接预览时仍可运行处理任务并导出结果。二进制的许可按实际构建配置和包内说明确定。

开发：bun run --cwd apps/media-tools check / test / build；从仓库根目录使用 node scripts/package-app.mjs --app moss.media-tools 打包。
