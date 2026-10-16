# 开发验证记录

以下保留开发阶段验证详情；正式版本与发布入口见 [初始发布说明](initial-local-apps-release.md)。

# 第一批本地任务 App

2026-10-16，三个 App 均为 `0.1.0`，支持 `darwin-arm64`，要求 Moss Host API `^3.11.0`。交付包括源码、本地安装包及真实 Moss 嵌入页面验证。未安装到用户日常使用的 Moss 配置，也未发布市场。

## 实现形式

三者采用 `apps/` 下有自己代码的普通 Moss App：React UI、Node Backend、本地开源引擎及 AI 工具。页面负责预览、选择、编辑和导出，Backend 管理文件、任务和引擎进程。

仓库的 `mcp-apps/` 用于配置型 MCP App，适合复用 Core 公共页面。此次图片裁剪、PDF 页面编排和逐字稿校对需要独立交互，因此使用普通 App。AI 通过 Moss 原生 `contributes.tools` 调用同一 Backend，不额外套 MCP transport；以后接已有 MCP 服务时仍可以保留这层 UI。

三个入口都位于“更多”，分类为“知识与文件”，`toolScope: session`。在会话选择对应 App 后，AI 可导入文件、提交任务和查看进度；这些任务和结果同时出现在页面。

## 用户可以完成的任务

| App | 本地引擎 | Moss 内的操作与结果 |
| --- | --- | --- |
| [图片工具](../apps/image-tools/README.md) | sharp 0.34.5 | 批量转换和压缩、调整宽度、拖动或输入裁剪范围、结果画廊、未裁剪图片前后对比、导出 |
| [PDF 工作台](../apps/pdf-tools/README.md) | pdf-lib 1.17.1、PDF.js 5.4.624、Tesseract.js 6.0.1 | 页面缩略图、选择和排序、旋转、合并、逐页拆分、中英文 OCR、翻页缩放、全文检索、PDF/文字导出 |
| [语音转写](../apps/transcription/README.md) | Whisper.cpp / @fugood/whisper.node 1.1.3、FFmpeg 8.0 | 音频和视频转写、播放器和真实波形、点击句子跳转播放、搜索、文字校对、同步导出 TXT/SRT/VTT |

图片和 PDF 的引擎及 OCR 语言数据随包提供；转写的多语言 base 模型也完整包含在发布 ZIP，首次使用在本机解压并校验即可离线使用。用户无需另装 Python、Tesseract、Whisper CLI、FFmpeg、图片编辑器、PDF 阅读器或播放器。

## 安装包

| App | ZIP | 大小 |
| --- | --- | --- |
| 图片工具 | [moss.image-tools-0.1.0-darwin-arm64.zip](../artifacts/moss.image-tools/0.1.0/moss.image-tools-0.1.0-darwin-arm64.zip) | 7.9 MiB |
| PDF 工作台 | [moss.pdf-tools-0.1.0-darwin-arm64.zip](../artifacts/moss.pdf-tools/0.1.0/moss.pdf-tools-0.1.0-darwin-arm64.zip) | 77.3 MiB |
| 语音转写 | [moss.transcription-0.1.0-darwin-arm64.zip](../artifacts/moss.transcription/0.1.0/moss.transcription-0.1.0-darwin-arm64.zip) | 152.3 MiB，已含模型 |

这些是本地开发包。每包包含 `source/`、固定 SDK、依赖锁文件和 `source-manifest.json`，已从独立源码目录完成安装、检查、测试和构建。校验摘要、源码摘要和验证项目汇总见 [delivery.json](../artifacts/local-task-apps/delivery.json)。正式市场发布使用仓库既有签名发布流程。

## 共用代码与运行方式

[packages/local-tasks](../packages/local-tasks/) 提供共享文件管理、串行任务队列、独立工作进程、取消、进度、任务记录、导出和主题 UI。后续本地工具可以复用这部分，只实现具体引擎和工作页面。

输入复制到 App 数据目录，原文件保留。预览通过绑定回环地址、带随机令牌的只读服务提供，支持音频和 PDF 的 Range 请求。导出使用 Moss 文件夹选择器，文件重名时增加序号。关闭页面后继续处理；退出 Moss 会停止工作，重启保留已完成结果，并将未完成任务标为中断供重试。

运行包只携带引擎的生产依赖和当前平台原生文件。构建时拒绝同名运行依赖版本冲突。PDF 的 Canvas 固定为 0.1.100，与 PDF.js 依赖统一，避免加载两套原生 Canvas；浏览器端的 Worker、CMap、字体和解码资源也随包提供。

应用代码许可证为 MIT；第三方组件保留各自许可证。转写所带 FFmpeg 二进制声明 GPL-2.0-or-later，构建检查拒绝 `--enable-nonfree`，附带原始许可、版本与配置记录，不能把整个运行包都视为 MIT。

## 验证证据

三个 App 的类型检查、Manifest 校验、8 项业务/回归测试、安装包 Backend 握手、源码独立重建均通过。实际 Moss 验证使用 Core 的 `EmbeddedAppView`、真实 preload、ZIP 安装器、Host 协议处理器与 Backend；仅文件选择对话框采用确定性的测试文件路径。测试在临时用户目录进行，结束后清理。

[验证脚本](../scripts/verify-local-task-apps.mjs) 的 14 项检查覆盖：

- 图片：AI 导入 TIFF 后 UI 可预览；随包 sharp 转换生成正确尺寸；前后对比；重复导出保留同名文件。
- PDF：在 UI 调整页面顺序与旋转，检查真实 PDF 结构；扫描图像的中英文 OCR；中文搜索忽略汉字间的额外识别空格；查看和导出结果。
- 转写：随包 FFmpeg 从视频提取音频；真实多语言模型识别 11 秒 JFK 录音和中文合成语音；播放和句子跳转时间正确；校对同步更新字幕；旧版本保存被拒绝；取消新任务不损失已有结果。
- 共同行为：session 工具发现范围、明暗主题、420 px 窄窗口布局、Backend 重启后的文件和预览恢复、停用与重新启用。

三个报告均无 `pageerror`：[图片报告](../artifacts/local-task-apps/verification/image-tools/report.json)、[PDF 报告](../artifacts/local-task-apps/verification/pdf-tools/report.json)、[转写报告](../artifacts/local-task-apps/verification/transcription/report.json)。

界面截图：[图片处理](../artifacts/local-task-apps/verification/image-tools/result-light.png)、[PDF 中文检索](../artifacts/local-task-apps/verification/pdf-tools/ocr-light.png)、[PDF 暗色主题](../artifacts/local-task-apps/verification/pdf-tools/result-dark.png)、[中文逐字稿](../artifacts/local-task-apps/verification/transcription/chinese-light.png)、[窄窗口](../artifacts/local-task-apps/verification/transcription/result-narrow.png)。

## 首版范围

- 目前声明和实测的平台为 Apple Silicon macOS，其他平台尚未适配。
- 图片支持静态 JPEG/PNG/WebP/AVIF/TIFF，单图最多 6000 万像素；自动 EXIF 旋转，不放大；JPEG 透明背景转为白色。暂未实现抠图或动画处理。
- PDF 单文件最多 250 MiB、500 页；每次 OCR 最多 80 页。OCR 输出为 144 DPI 页面图像加文字层，原件保留，矢量、签名和交互表单结构不会保留。加密 PDF 拒绝处理。
- 转写输入最多 2 GiB、2 小时；首次使用不需要联网下载模型。首版不含实时会议、说话人分离和时间戳编辑。实际验证使用短录音；噪声、多人重叠和长录音的识别结果仍需校对，中文可能输出繁体。

## 复现

```sh
bun install
node scripts/validate-apps.mjs
node scripts/package-app.mjs --app moss.image-tools
node scripts/package-app.mjs --app moss.pdf-tools
node scripts/package-app.mjs --app moss.transcription
node scripts/verify-source-package.mjs --app moss.image-tools --rebuild
node scripts/verify-source-package.mjs --app moss.pdf-tools --rebuild
node scripts/verify-source-package.mjs --app moss.transcription --rebuild
```

桌面验证需要完整的 Moss Core checkout 及 Electron 依赖；`MOSS_TEST_AUDIO` 指向 Whisper.cpp 的 `samples/jfk.wav`，`MOSS_TEST_MODEL` 指向 README 中固定 SHA-256 的多语言 base 模型。可通过 `MOSS_TEST_CHINESE_AUDIO` 提供上述中文合成语音；未指定时检查验证目录的 `中文会议.aiff`，没有该文件就跳过这项附加检查。

```sh
MOSS_CORE_ROOT=/path/to/moss \
MOSS_TEST_AUDIO=/path/to/jfk.wav \
MOSS_TEST_MODEL=/path/to/ggml-base.bin \
node scripts/verify-local-task-apps.mjs
```

## 随包依赖与 CI 更新

最新包大小、断网验证、重建与市场登记结果见 [CI 交付记录](local-apps-ci-delivery.md)。最新安装包已包含转写模型；旧 UI 报告记录交互覆盖，当前 ZIP 的依赖完整性以带 `archiveSha256` 的断网报告为准。UI 验证脚本已移除模型缓存预填充。
