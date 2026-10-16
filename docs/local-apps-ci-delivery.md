# 六个本地 App 的随包依赖与 CI 交付

2026-10-16。六个 App 的实际发布 ZIP 已包含固定版本开源引擎及运行依赖，转写模型也在 ZIP 内。用户首次使用只需本机解压与校验，无需另外下载依赖或安装上游 GUI。当前平台为 macOS Apple Silicon（`darwin-arm64`），版本均为 `0.1.0`。

| App | ZIP 内的实际依赖 | 最终包 |
| --- | --- | --- |
| 图片工具 | sharp、原生 libvips | [7.9 MiB](../artifacts/moss.image-tools/0.1.0/moss.image-tools-0.1.0-darwin-arm64.zip) |
| PDF 工作台 | PDF.js、pdf-lib、Canvas、Tesseract、中文/英文 OCR 数据 | [77.3 MiB](../artifacts/moss.pdf-tools/0.1.0/moss.pdf-tools-0.1.0-darwin-arm64.zip) |
| 语音转写 | Whisper 原生模块、FFmpeg、完整多语言 base 模型 | [152.3 MiB](../artifacts/moss.transcription/0.1.0/moss.transcription-0.1.0-darwin-arm64.zip) |
| 文件清理 | Czkawka、FFmpeg、ffprobe | [40.4 MiB](../artifacts/moss.file-cleaner/0.1.0/moss.file-cleaner-0.1.0-darwin-arm64.zip) |
| 文档格式转换 | Pandoc、Typst PDF 引擎 | [61.2 MiB](../artifacts/moss.document-converter/0.1.0/moss.document-converter-0.1.0-darwin-arm64.zip) |
| 代码地图 | codebase-memory-mcp 原生服务 | [45.6 MiB](../artifacts/moss.code-map/0.1.0/moss.code-map-0.1.0-darwin-arm64.zip) |

详细字节数、SHA-256、源码哈希和断网报告见 [交付清单](../artifacts/offline-apps/delivery.json)。本地产物未签名、未上线；正式发布工作流会生成签名包。

## 构建和运行

- 构建期：按锁文件与资源描述下载固定版本，校验上游归档及二进制 SHA-256，然后放入 App 的 `dist/`。CI 缓存只用来加快构建，最终运行不依赖 CI 缓存。
- 运行期：小型引擎直接使用包内文件。Pandoc、代码地图、Whisper 模型等大文件按确定性 gzip 压缩并分成不超过 64 MiB 的资源，首次使用流式还原到实例私有目录，校验大小和哈希后原子替换。
- 保留现有 Host 的单文件 128 MiB、总包 512 MiB 限制，无需为模型放宽安装校验。资源损坏或缺失明确报错，不自动下载补装。
- Pandoc 默认 PDF 引擎改为随包 Typst；自定义 filter、模板、其他 PDF 引擎，以及文档引用的远程素材，仍遵循用户选择的文件和参数。
- 代码地图通过上游 `CBM_RUNTIME_DIR` 隔离实例的运行目录，同一实例的 UI 与 Agent 共用索引，可与其他 CBM 安装并行运行。

实现入口：[构建期准备](../packages/engine-apps/src/download.mjs)、[压缩打包](../packages/engine-apps/src/bundle-build.mjs)、[本地还原](../packages/engine-apps/src/bundled.mjs)。CLI 仍通过随包 skill 给 Agent 调用，代码地图仍通过原生 MCP tools 调用；三个原生任务 App 保留 Backend tools。

## CI 与应用市场

六个 Manifest 均已声明 `platforms: ["darwin-arm64"]`，修复之前只有 marketplace 声明平台、导致 CI 按通用 Linux 包处理的问题。

[CI](../.github/workflows/ci.yml) 与 [单 App 发布工作流](../.github/workflows/release-app.yml) 已加入依赖缓存、目标平台构建、最终 ZIP 断网功能验证和报告上传。普通 CI 也上传平台 ZIP。发布保留签名校验、独立源码重建与各平台产物完整性校验。

[自动发布](../.github/workflows/release-apps.yml) 自动发现六个 App，发布后进入已有的市场目录生成流程，无需手写另一份注册列表。使用本轮六份真实 `.release.json` 已生成 [市场预览](../artifacts/offline-apps/market-preview/v1/index.json)，含分类、图标和 `darwin-arm64` 下载项。只读 GitHub 发布扫描中，六个 App 均为 `publish / new-app`，见 [发布计划](../artifacts/offline-apps/release-plan.json)。

初始正式版统一为 `0.1.1`，Core 已固定到 [8e399848](https://github.com/baiguidong/moss/commit/8e39984889590c162fa23db98ea8c114d6ad71a0)。正式签名包由 GitHub Actions 从干净提交构建；上述本地开发包用于历史验证，不直接上传为正式发行版。发布流程和在线结果见 [初始发布说明](initial-local-apps-release.md)。

## 验证

[断网验证器](../scripts/verify-bundled-apps.mjs) 从最终 ZIP 解压运行，使用全新数据目录，在 macOS OS sandbox 中禁止外部 IP 连接、仅允许本地回环。每个报告记录所测 ZIP 的 SHA-256：

- 图片：实际缩放与 WebP 转换。
- PDF：实际 PDF 渲染、中间图像与英文 OCR。
- 转写：包内 FFmpeg 解码，Whisper 原生推理与逐字稿生成。
- 清理：重复文件扫描、真实视频生成与扫描。
- 文档：DOCX 生成、内容回读预览、Typst PDF 导出。
- 代码地图：17 个 MCP tools、仓库索引及符号查询。

六个 ZIP 均完成独立源码重建，逐文件运行产物哈希一致。源码打包、平台矩阵与市场回归共 19 项通过；运行适配测试共 12 项通过，覆盖构建期 ZIP/TGZ/TXZ 解包、分片乱序/损坏/解压大小限制、并发、取消、目录权限与缺失资源不发起下载。两份工作流通过 actionlint；所用 1.7.7 对已有的 `macos-15-intel` 标签较旧，检查时仅忽略该已知标签提示。

本轮另外复测真实 Moss 容器中的文档转换、转写和代码地图 UI，验证产物预览、播放、字幕修改、源码与调用图、Agent 独立入口、暗色/窄窗口和重启保留；没有为 UI 预填充引擎或模型缓存。代码地图复测时本机另一套 CBM 服务仍在运行，独立运行目录验证通过。既有交互覆盖与截图见 [本地任务](local-task-apps-delivery.md) 和 [CLI/MCP 引擎](engine-apps-delivery.md) 交付记录。

```sh
node scripts/package-app.mjs --app moss.transcription --platform darwin-arm64
node scripts/verify-source-package.mjs --app moss.transcription --rebuild
node scripts/verify-bundled-apps.mjs
```

构建可选设置绝对路径 `MOSS_BUILD_DEPENDENCY_CACHE` 复用已经过哈希校验的下载；用户安装后不需要设置这个变量。
