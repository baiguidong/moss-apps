# 六个本地 App 初始发布

初始正式版：**0.1.1**。首批验证平台为 **macOS 15+ Apple Silicon（darwin-arm64）**。由 GitHub Actions 从干净源码构建并签名，发布成功后自动进入 Moss 应用市场。

| App | 正式版本入口 |
| --- | --- |
| 图片工具 | [0.1.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.image-tools-v0.1.1) |
| PDF 工作台 | [0.1.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.pdf-tools-v0.1.1) |
| 语音转写 | [0.1.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.transcription-v0.1.1) |
| 文件清理 | [0.1.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.file-cleaner-v0.1.1) |
| 文档格式转换 | [0.1.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.document-converter-v0.1.1) |
| 代码地图 | [0.1.1](https://github.com/baiguidong/moss-apps/releases/tag/moss.code-map-v0.1.1) |

六个 App 均内置其固定运行依赖；语音转写包含完整多语言 base 模型，PDF 包含中英文 OCR 数据。首次运行的资源还原在本机完成。用户无需另装上游 GUI。

图片、PDF、转写提供 Agent 工具；文件清理和文档格式转换提供随包 CLI skill；代码地图提供 MCP tools。传统 UI 操作与 Agent 调用共享任务和结果。

Core 固定到 [8e399848](https://github.com/baiguidong/moss/commit/8e39984889590c162fa23db98ea8c114d6ad71a0)，SDK 来源标记为干净。CLI skill 与新的能力展示要求包含该提交的 Moss Host API 3.14；仅发布 App 不会替换已安装的旧版桌面客户端。

发布工作流移除已迁移 Git / 文件系统 App 的旧 UI 测试路径，新增路径存在性回归。定时检查仍为 UTC `17 */6 * * *`，已经成功发布的同版本会跳过，失败或尚未发布的版本才会继续尝试。

[发布任务](https://github.com/baiguidong/moss-apps/actions/workflows/release-apps.yml)负责签名、目标平台构建、最终 ZIP 断网运行、独立源码重建和 GitHub Releases 上传；随后[市场发布任务](https://github.com/baiguidong/moss-apps/actions/workflows/publish-catalog.yml)生成市场目录。在线状态以工作流与正式版本入口为准。

开发阶段的具体功能验证见[界面更新](app-ui-refinement.md)和[随包依赖与 CI](local-apps-ci-delivery.md)。其中本地 artifacts 为历史验证记录，正式下载使用上表 GitHub Releases。

首次线上验证补充：Whisper 1.1.3 的 Mach-O `LC_BUILD_VERSION` 声明 `minos 15.0`，因此语音转写要求 macOS 15 或更新版本，普通 CI 与正式发布统一使用 macOS 15。发布汇总节点继续校验所有签名、校验和、源码及平台身份；原生 Backend 握手与源码重建由对应平台节点执行，Linux 汇总节点不会尝试加载 macOS 原生模块。
