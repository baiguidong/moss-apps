# 语音转写

普通 Moss App `moss.transcription@0.1.1`，包含独立 React UI、Node Backend、本地 Whisper 引擎和音频预处理。需要 Moss Host API >=3.11，首版验证 macOS Apple Silicon，无需用户安装播放器、Whisper CLI 或 FFmpeg。

在“更多 → 语音转写”导入本地音频/视频，选择语言并开始。结果包含可播放音频、真实波形、带时间戳的逐字稿和 TXT/SRT/VTT 文件。点击句子时间跳转播放，修改文本后“保存校对”，再导出；保存同时更新字幕文件。并发保存采用版本检查，拒绝覆盖其他页面已保存的版本。

Whisper.cpp 通过 MIT 的 `@fugood/whisper.node@1.1.3` 原生绑定调用，随包包含 macOS arm64 运行模块和 Metal 库。多语言 base 模型由 CI 下载并校验后压缩分片后放入发布 ZIP 的 `dist/models/`，固定 Hugging Face revision `5359861c739e955e79d9a303bcbc70fb988958b1`，文件 147951465 字节，SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`。首次使用在本机解压并校验模型即可离线转写，不下载模型、不上传录音。模型缺失或损坏时明确报错，不自动联网补装。

FFmpeg 使用锁定 npm 依赖 `@drbearzay/ffmpeg-darwin-arm64@8.0.1`，复制到 App 私有运行目录并恢复执行权限。它只用于把音频转换为 16 kHz 单声道 WAV。输入最多 2 GiB、最长 2 小时，任务串行，支持取消；不支持实时会议、说话人分离、时间戳编辑和自动摘要。短片段、噪声和混合语言可能影响识别，应在页面校对。

AI 导入、创建任务和查询与 UI 使用同一份记录。页面关闭继续处理；Moss 退出停止后台工作，重启将未完成任务标为中断，结果保留。导出选择文件夹并保留同名文件。

```sh
bun run --cwd apps/transcription check
bun run --cwd apps/transcription test
bun run --cwd apps/transcription build
node scripts/package-app.mjs --app moss.transcription
```

业务测试覆盖字幕格式、Unicode、时间进位和错误输入；真实模型、录音与安装包验证另见仓库交付记录。App/Whisper 绑定为 MIT；FFmpeg 的许可按实际二进制构建配置确定，不能将整个运行包称为 MIT。
