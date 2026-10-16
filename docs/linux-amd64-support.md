# Linux AMD64 支持清单

2026-10-16。目标环境为 Linux x86_64 / glibc：CI 使用 Ubuntu 24.04，云电脑镜像使用 Debian 12 Bookworm / Node 22。每个用户仍使用自己的长期保留容器。此次不新增 Linux ARM64 声明；已有其他平台声明继续保留。

本次 23 个新版本已正式发布并进入公开市场。目录共 26 款 App，其中 25 款提供 Linux x64 支持；开发工具、AI 自测沿用已有版本，电脑操控暂不支持 Linux。7 款包含原生依赖的 App 提供独立 Linux 包。

WebUI 的市场展示已验证通过。App 的浏览器安装、界面通信和部分 Host 交互尚待接入，因此下表的 Linux 平台支持还不能代表浏览器端已完成安装和使用闭环。

## 市场展示

Moss Core 从 Host 的 `process.platform`、`process.arch` 选择应用，列表只返回最新版本具有对应安装包的 App。WebUI 按云电脑的 Linux 筛选，与客户浏览器所在电脑的系统无关。分类和数量使用同一列表；版本选择器也隐藏不适用于当前平台的版本。API 版本不足时保留明确的版本提示。安装校验、签名和 SHA-256 校验继续执行。

Core 提交 `361e1e36`（市场过滤）及 `841ad355`（OpenMP 运行库）已合并 main。WebUI 镜像 `ghcr.io/baiguidong/moss-webui:0.0.1-webui.20261016.8` 在 GitHub Linux AMD64 构建并验证，已原地升级两个现有用户环境，保留原 container ID；网关与新用户默认镜像也已更新。

镜像摘要：`sha256:f34174429a04f55dc2c557be4d7c70421020b6c23d376dcb594f81a2dd91c071`。

## App 版本与 Linux 支持

以下版本均已正式发布。公开目录逐项核对了版本、Linux 包、签名信息、源码标记、包大小和 GitHub Release 资产摘要，见 [发布核对记录](data/linux-native-20261016/published-catalog.json)。

| App | 版本 | 包形式 | Linux 依赖与验证范围 |
| --- | --- | --- | --- |
| 飞书 `moss.feishu` | [0.4.14](https://github.com/baiguidong/moss-apps/releases/tag/moss.feishu-v0.4.14) | 通用包 | Node/Lark SDK；构建和 Backend 测试，不使用真实用户账号发送消息 |
| 即时消息 `moss.openim` | [0.2.14](https://github.com/baiguidong/moss-apps/releases/tag/moss.openim-v0.2.14) | 独立平台包 | Linux OpenIM `.so`、Koffi `.node`；各平台只携带对应原生库，测试加载和进程退出 |
| 调用追踪 `moss.trace` | [0.1.6](https://github.com/baiguidong/moss-apps/releases/tag/moss.trace-v0.1.6) | 通用包 | Node + Host 追踪协议 |
| 分步思考 `moss.sequential-thinking` | [0.1.4](https://github.com/baiguidong/moss-apps/releases/tag/moss.sequential-thinking-v0.1.4) | MCP 配置包 | Host 管理的 Node MCP 服务 |
| 工作流 `moss.workflow` | [0.1.17](https://github.com/baiguidong/moss-apps/releases/tag/moss.workflow-v0.1.17) | 通用包 | Node + Host 会话协议 |
| 记忆 `moss.memory` | [0.2.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.memory-v0.2.2) | 通用包 | Node MCP、文件存储、锁 |
| 审计中心 `moss.audit` | [0.1.8](https://github.com/baiguidong/moss-apps/releases/tag/moss.audit-v0.1.8) | 通用包 | Host 审计协议、本地数据库 |
| 网盘 `moss.drive` | [0.3.6](https://github.com/baiguidong/moss-apps/releases/tag/moss.drive-v0.3.6) | 通用包 | Host 云存储协议；文件选择和下载交互需要对应 Host 适配 |
| 网页操控 `moss.browser-use` | [0.1.6](https://github.com/baiguidong/moss-apps/releases/tag/moss.browser-use-v0.1.6) | 通用包 | Playwright/Chrome；无图形会话时需 headless，另需浏览器系统依赖 |
| 文件系统 `moss.filesystem` | [0.1.3](https://github.com/baiguidong/moss-apps/releases/tag/moss.filesystem-v0.1.3) | MCP 配置包 | Host 管理的 Node MCP，操作当前会话目录 |
| 应用构建 `moss.app-builder` | [0.1.4](https://github.com/baiguidong/moss-apps/releases/tag/moss.app-builder-v0.1.4) | 通用包 | Node + Host 构建/安装能力；预览受 Host 展示能力限制 |
| 语义知识库 `moss.knowledge-rag` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.knowledge-rag-v0.1.2) | 通用包，首次准备 Python 环境 | 固定哈希跨平台锁；Linux 安装 Chroma/FastEmbed/ONNX 并验证向量查询，首次模型准备需下载 |
| 知识库 `moss.library` | [0.1.10](https://github.com/baiguidong/moss-apps/releases/tag/moss.library-v0.1.10) | 通用包 | Node SQLite、Python、通用 pypdf；Linux 目录监听配合周期扫描 |
| Buddy `moss.buddy` | [0.1.3](https://github.com/baiguidong/moss-apps/releases/tag/moss.buddy-v0.1.3) | 通用包 | Node + Host 会话/通知协议 |
| Draw.io `moss.drawio` | [0.1.5](https://github.com/baiguidong/moss-apps/releases/tag/moss.drawio-v0.1.5) | MCP 配置包 | 跨平台 MCP 配置 |
| Git 仓库 `moss.git` | [0.1.3](https://github.com/baiguidong/moss-apps/releases/tag/moss.git-v0.1.3) | MCP 配置包 | Python MCP 和容器内 Git 程序 |
| MCP 管理 `moss.mcp` | [0.1.11](https://github.com/baiguidong/moss-apps/releases/tag/moss.mcp-v0.1.11) | 通用包 | Node + Host MCP 管理协议 |
| 图片工具 `moss.image-tools` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.image-tools-v0.1.2) | 独立平台包 | sharp/libvips Linux 原生模块；真实图片缩放转换 |
| PDF 工作台 `moss.pdf-tools` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.pdf-tools-v0.1.2) | 独立平台包 | Linux Canvas、PDF.js、Tesseract 与 OCR 字库；真实 PDF OCR |
| 语音转写 `moss.transcription` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.transcription-v0.1.2) | 独立平台包 | Linux Whisper CPU、FFmpeg、多语言 base 模型；离线推理，系统需 `libgomp1`，不要求 CUDA/Vulkan/显卡 |
| 文件清理 `moss.file-cleaner` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.file-cleaner-v0.1.2) | 独立平台包 | Czkawka musl CLI、FFmpeg、ffprobe；重复文件与视频扫描 |
| 文档格式转换 `moss.document-converter` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.document-converter-v0.1.2) | 独立平台包 | Linux Pandoc、Typst；生成 DOCX、HTML 预览和 PDF |
| 代码地图 `moss.code-map` | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.code-map-v0.1.2) | 独立平台包 | Linux portable codebase-memory-mcp；工具列表、真实代码索引、符号查询 |
| 开发工具 `moss.devtools` | [0.2.5](https://github.com/baiguidong/moss-apps/releases/tag/moss.devtools-v0.2.5)（已有） | 通用包 | 原版本已经声明 Linux，本次不重复发布 |
| AI 自测 `moss.self-test` | [0.1.0](https://github.com/baiguidong/moss-apps/releases/tag/moss.self-test-v0.1.0)（已有） | 通用包 | 原版本已经声明 Linux；目前测试目标仍是独立 Electron 实例，无窗口 Web Host 尚未适配 |
| 电脑操控 `moss.computer-use` | [0.2.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.computer-use-v0.2.1)（保持） | macOS/Windows 平台包 | 不声明 Linux：Host 和原生窗口控制仅实现 macOS AX、Windows UI Automation，不能只改平台字段 |

## 验证与边界

- 原容器的程序升级会保留系统层，不会自动同步新镜像的 apt 软件。旧镜像运行 Whisper 前需安装 `libgomp1`（`sudo apt-get update && sudo apt-get install -y libgomp1`）。两个现有用户容器已经补齐并验证加载成功；新镜像内置此依赖。
- 六个原生工具在 [Linux 实测工作流](https://github.com/baiguidong/moss-apps/actions/runs/38883322252) 全部通过。用空数据目录、Linux 网络命名空间禁止外部网络，直接执行最终 ZIP 中的 worker/CLI/MCP。逐项证据见 [data/linux-native-20261016](data/linux-native-20261016)。
- [正式发布批次](https://github.com/baiguidong/moss-apps/actions/runs/38885293373) 与 [仓库 CI](https://github.com/baiguidong/moss-apps/actions/runs/38885293388) 均通过。发布检查包含源码、业务测试、Backend 协议握手、独立源码重建、签名和完整平台变体；OpenIM 的正式包来自同样通过验证的较早源码提交，版本标签保持原绑定。
- 在实际 Bookworm `.8` 镜像中，关闭网络后验证了六个 CLI 启动、OpenIM/Koffi 与 Whisper 原生模块加载、正式图片包的缩放转换和 PDF 包的 Canvas 绘制，见 [镜像验证记录](data/linux-native-20261016/bookworm-native.json)。
- [WebUI 构建验收](https://github.com/baiguidong/moss/actions/runs/38887742940) 包括浏览器、双用户、同容器停启及程序升级回滚。部署后从 macOS 浏览器登录，实际 Host 为 `linux-x64` / API `3.14.0`，展示 25 款对应版本的 App，隐藏电脑操控，无不兼容提示或页面异常；见 [浏览器验证记录](data/linux-native-20261016/browser-market.json)。
- 平台声明表示安装包可以在目标 Linux 上执行，不等于所有 App 已可在浏览器中安装和打开。当前 Web Host 的 App 安装确认、iframe/通信桥及部分文件交互仍需补齐；本次未取消该限制，也未伪造 Electron sender。
- 系统电脑操控需要额外 Linux 适配与可操作的图形会话。网页自动化使用 headless 浏览器，不需要完整 Linux 桌面会话。
- 实际飞书/OpenIM 服务登录、文件服务账号、付费模型等依赖业务配置，本次未以真实账号执行外发消息或付费模型测试。
