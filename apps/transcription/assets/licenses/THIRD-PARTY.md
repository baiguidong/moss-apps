# 第三方组件

应用代码为 MIT。锁定依赖及其原始许可证位于 `dist/backend/node_modules`，完整依赖来源和摘要位于随包源码的 bun.lock。不能将 App 许可证代替第三方许可证。

Whisper.cpp、@fugood/whisper.node: MIT。模型来自 https://huggingface.co/ggerganov/whisper.cpp ，摘要和 revision 见 README。FFmpeg 来自固定 @drbearzay/ffmpeg-darwin-arm64@8.0.1，二进制声明 GPL-2.0-or-later，未启用 nonfree。具体许可与构建见 ffmpeg-version.txt 和 FFmpeg-LICENSE.md；不能将其视为 MIT。FFmpeg 源码和对应发行说明见 https://ffmpeg.org/download.html 和 https://github.com/kribblo/node-ffmpeg-installer 和 https://www.osxexperts.net/ 。
