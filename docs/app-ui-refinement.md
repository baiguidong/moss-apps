# 开发验证记录

以下保留开发阶段验证详情；正式版本与发布入口见 [初始发布说明](initial-local-apps-release.md)。

# 本地 App 界面与动态工具目录修复

2026-10-16，六个本地 App 更新为 `0.1.1`，平台为 `darwin-arm64`。本次继续使用开源引擎，App 只实现交互、参数适配、任务记录和结果展示。

## 图片工具

原实现仅暴露 sharp 的部分能力；现在 UI 分成格式与压缩、尺寸与填充、裁剪、旋转与翻转、色彩调整、清晰度、文字水印、图片信息八组。支持静态 JPEG、PNG、WebP、AVIF、TIFF，TIFF 输入与输出均有内嵌预览。

裁剪支持鼠标框选、拖动移动、八个边角手柄、固定比例、数值输入、方向键与 Shift 微调。点击“开始处理”应用选区；“取消裁剪”关闭该处理项。坐标以自动纠正 EXIF 方向后的原图为准，后端先裁剪再执行用户指定的旋转。

缩放、填充、旋转、调色、降噪、模糊锐化、水印和元数据处理均交给 sharp/libvips。独立 Agent 入口为五个真实工具：导入、工作区、处理任务、取消任务、导出；具体图片操作通过任务参数组合。

交互截图：[鼠标裁剪](../artifacts/local-task-apps/verification/image-tools/crop-mouse.png)。实现与边界见 [图片工具 README](../apps/image-tools/README.md)。

## 空间利用

六个 App 不再重复绘制 Moss 容器已经提供的可见标题。共用 MCP 设置页也保留屏幕阅读器标题、删除重复的可见品牌标题。

代码地图、文件清理、文档格式转换删除顶部独立的“准备 / 检查引擎”栏，业务界面从页面顶部开始。引擎自动准备，检查入口收纳到底部状态栏，错误提示内提供重新检查。任务数量只在任务记录处显示。代码地图左侧仓库面板收窄，将主要宽度留给源码与调用关系，窄窗口改为单列。

截图：[代码地图](../artifacts/engine-apps/verification/code-map/light.png)、[窄窗口](../artifacts/engine-apps/verification/code-map/narrow.png)。

## 动态工具目录

旧 App 详情只读取静态 `agentTools`，导致纯 MCP Excel App 被误报为没有工具。现在顶部入口、App 卡片与详情合并静态工具和 MCP 实际发现结果，CLI skill 单独标示。

- 未检查的 MCP 显示“工具待发现”，不当成零个工具。
- 连接后显示真实数量、名称和描述；加载失败、待授权与停用有独立状态。
- 自动检查只传 Host 接受的服务标识字段。
- 发现过程中的父组件更新不会丢弃响应；连接配置、授权、启停和目录更新会刷新顶部显示。
- Excel `excel-mcp-server==2.0.0` 实测 42 个工具；代码地图实测 17 个工具。

代码地图先准备共享的上游进程，再向 Host 注册 MCP 入口，避免 UI 与 Host 同时首次启动上游时的连接等待。

Core 源码在相邻 `moss` 仓库，专门的 [Core 补丁](https://github.com/baiguidong/moss/commit/8e39984889590c162fa23db98ea8c114d6ad71a0) 仅包含本轮界面改动，可与原有 [CLI skill 配套补丁](https://github.com/baiguidong/moss/commit/8e39984889590c162fa23db98ea8c114d6ad71a0) 分开检查。截图：[Excel 的 42 个工具](../artifacts/app-capabilities/excel-tools.png)。

## 验证与交付

可复现命令：

```sh
node --test apps/image-tools/tests/*.test.mjs scripts/code-map-runtime.test.mjs
node scripts/verify-local-task-apps.mjs --app moss.image-tools
node scripts/verify-engine-ui.mjs --app moss.code-map
node scripts/verify-engine-ui.mjs --app moss.file-cleaner
node scripts/verify-engine-ui.mjs --app moss.document-converter
node scripts/verify-bundled-apps.mjs
```

真实 UI 测试使用隔离的 Electron/Host 配置与最终安装 ZIP，裁剪使用实际鼠标事件，并对输出尺寸、参数及处理结果做核对。Excel 使用真实 MCP 目录，覆盖发现期间刷新和启停后的可用性。所有测试使用合成文件及临时 App 数据。

本轮六个最终 ZIP 的断网功能验证全部通过；图片、代码地图、文件清理和文档格式转换的真实 UI 与独立源码重建通过。图片与目录适配测试 6 项、Core 工具目录相关测试 39 项、源码打包与市场回归 6 项通过，TypeScript 检查通过。逐包 SHA-256、检查结果与重建源码哈希见 [本轮交付清单](../artifacts/app-ui-refinement/delivery.json)。

`artifacts/moss.<名称>/0.1.1/` 下提供新版 ZIP 与发布清单，完整离线依赖仍随包提供。六个 App 的 CI 和市场注册方式沿用 [随包依赖交付](local-apps-ci-delivery.md)。相邻 `moss/ui` 的主渲染层与共用 MCP 页面已经重新构建。本轮未推送、签名或发布市场，也未替换用户当前安装的 App；使用新版界面需要安装对应 `0.1.1` 包，并重新启动本地开发版 Moss。
