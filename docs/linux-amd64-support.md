# Linux AMD64 支持清单

2026-10-16。目标环境为 Linux x86_64（Ubuntu 24.04 / glibc），包括每用户长期保留的 Moss 云电脑容器。此次不新增 Linux ARM64 声明；已有其他平台声明继续保留。

## 市场展示

Moss Core 从 Host 的 `process.platform`、`process.arch` 选择应用，列表只返回最新版本具有对应安装包的 App。WebUI 按云电脑的 Linux 筛选，与客户浏览器所在电脑的系统无关。分类和数量使用同一列表；版本选择器也隐藏不适用于当前平台的版本。API 版本不足时保留明确的版本提示。安装校验、签名和 SHA-256 校验继续执行。

Core 提交 `361e1e36` 已合并 main。WebUI 镜像 `ghcr.io/baiguidong/moss-webui:0.0.1-webui.20261016.7` 在 GitHub Linux AMD64 构建并验证，已原地升级 `10.0.1.181` 的两个用户环境，保留原 container ID。

## App 版本与 Linux 支持

以下为本次目标版本。发布状态将在所有签名任务与公开目录检查完成后记录。

| App | 版本 | 包形式 | Linux 依赖与验证范围 |
| --- | --- | --- | --- |
| 飞书 `moss.feishu` | 0.4.14 | 通用包 | Node/Lark SDK；构建和 Backend 测试，不使用真实用户账号发送消息 |
| 即时消息 `moss.openim` | 0.2.14 | 独立平台包 | Linux OpenIM `.so`、Koffi `.node`；各平台只携带对应原生库，测试加载和进程退出 |
| 调用追踪 `moss.trace` | 0.1.6 | 通用包 | Node + Host 追踪协议 |
| 分步思考 `moss.sequential-thinking` | 0.1.4 | MCP 配置包 | Host 管理的 Node MCP 服务 |
| 工作流 `moss.workflow` | 0.1.17 | 通用包 | Node + Host 会话协议 |
| 记忆 `moss.memory` | 0.2.2 | 通用包 | Node MCP、文件存储、锁 |
| 审计中心 `moss.audit` | 0.1.8 | 通用包 | Host 审计协议、本地数据库 |
| 网盘 `moss.drive` | 0.3.6 | 通用包 | Host 云存储协议；文件选择和下载交互需要对应 Host 适配 |
| 网页操控 `moss.browser-use` | 0.1.6 | 通用包 | Playwright/Chrome；无图形会话时需 headless，另需浏览器系统依赖 |
| 文件系统 `moss.filesystem` | 0.1.3 | MCP 配置包 | Host 管理的 Node MCP，操作当前会话目录 |
| 应用构建 `moss.app-builder` | 0.1.4 | 通用包 | Node + Host 构建/安装能力；预览受 Host 展示能力限制 |
| 语义知识库 `moss.knowledge-rag` | 0.1.2 | 通用包，首次准备 Python 环境 | 固定哈希跨平台锁；Linux 安装 Chroma/FastEmbed/ONNX 并验证向量查询，首次模型准备需下载 |
| 知识库 `moss.library` | 0.1.10 | 通用包 | Node SQLite、Python、通用 pypdf；Linux 目录监听配合周期扫描 |
| Buddy `moss.buddy` | 0.1.3 | 通用包 | Node + Host 会话/通知协议 |
| Draw.io `moss.drawio` | 0.1.5 | MCP 配置包 | 跨平台 MCP 配置 |
| Git 仓库 `moss.git` | 0.1.3 | MCP 配置包 | Python MCP 和容器内 Git 程序 |
| MCP 管理 `moss.mcp` | 0.1.11 | 通用包 | Node + Host MCP 管理协议 |
| 图片工具 `moss.image-tools` | 0.1.2 | 独立平台包 | sharp/libvips Linux 原生模块；真实图片缩放转换 |
| PDF 工作台 `moss.pdf-tools` | 0.1.2 | 独立平台包 | Linux Canvas、PDF.js、Tesseract 与 OCR 字库；真实 PDF OCR |
| 语音转写 `moss.transcription` | 0.1.2 | 独立平台包 | Linux Whisper CPU、FFmpeg、多语言 base 模型；离线推理，不要求 CUDA/Vulkan/显卡 |
| 文件清理 `moss.file-cleaner` | 0.1.2 | 独立平台包 | Czkawka musl CLI、FFmpeg、ffprobe；重复文件与视频扫描 |
| 文档格式转换 `moss.document-converter` | 0.1.2 | 独立平台包 | Linux Pandoc、Typst；生成 DOCX、HTML 预览和 PDF |
| 代码地图 `moss.code-map` | 0.1.2 | 独立平台包 | Linux portable codebase-memory-mcp；工具列表、真实代码索引、符号查询 |
| 开发工具 `moss.devtools` | 0.2.5（已有） | 通用包 | 原版本已经声明 Linux，本次不重复发布 |
| AI 自测 `moss.self-test` | 0.1.0（已有） | 通用包 | 原版本已经声明 Linux；目前测试目标仍是独立 Electron 实例，无窗口 Web Host 尚未适配 |
| 电脑操控 `moss.computer-use` | 0.2.1（保持） | macOS/Windows 平台包 | 不声明 Linux：Host 和原生窗口控制仅实现 macOS AX、Windows UI Automation，不能只改平台字段 |

## 验证与边界

- 六个原生工具在 [Linux 实测工作流](https://github.com/baiguidong/moss-apps/actions/runs/38883322252) 全部通过。用空数据目录、Linux 网络命名空间禁止外部网络，直接执行最终 ZIP 中的 worker/CLI/MCP。逐项证据见 [data/linux-native-20261016](data/linux-native-20261016)。
- 每次正式发布仍检查源码、业务测试、Backend 协议握手、独立源码重建、签名和完整平台变体，失败的 App 不会发布。
- [WebUI 构建验收](https://github.com/baiguidong/moss/actions/runs/38882156047) 包括浏览器、双用户、同容器停启及程序升级回滚。
- 平台声明表示安装包可以在目标 Linux 上执行，不等于所有 App 已可在浏览器中安装和打开。当前 Web Host 的 App 安装确认、iframe/通信桥及部分文件交互仍需补齐；本次未取消该限制，也未伪造 Electron sender。
- 系统电脑操控需要额外 Linux 适配与可操作的图形会话。网页自动化使用 headless 浏览器，不需要完整 Linux 桌面会话。
- 实际飞书/OpenIM 服务登录、文件服务账号、付费模型等依赖业务配置，本次未以真实账号执行外发消息或付费模型测试。
