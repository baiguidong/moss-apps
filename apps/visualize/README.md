# 可视化

`moss.visualize@0.1.2` 是在主会话中使用的后台 App，没有独立业务 UI。新版 Moss 从“常用”和应用列表“打开”进入同一通用详情页，展示 App 介绍、自然语言试用示例、技能说明、版本、启停和使用范围。页面由 Core 提供，App 在 manifest 的 `overview` 中声明介绍和示例。

默认全局常驻，工具直接进入模型初始工具集合，启用后不必在会话中选择 App。点击示例回到主会话并填入自然语言，保留已有草稿，不自动发送。详情页可切换全局按需 / 全局常驻 / 按会话选择；停用后仍可打开查看信息和重新启用。Core 的详情页更新需要重启 Moss 生效，已安装旧版 App 可通过本地 ZIP 更新示例内容。

用户在主会话描述需求，AI 生成交互图表或演示并保存任务。模型用 `moss_present(result.presentation)` 动态控制右侧展示，并在最终回复使用 `result.displayMarkdown`，让消息直接呈现可操作的作品。用户固定内容或关闭跟随时保持其选择。

消息和右侧的滑块、筛选状态相互同步，重新打开后恢复。点击宿主“标注修改”，选择元素、文字或框选区域，在选区旁输入要求后直接发送至主会话；显示“1 处标注”卡片，定位信息和状态作为隐藏上下文传给模型。保留主输入框草稿，忙碌时排队。正常工具栏没有重新载入或整体继续修改。修改时传 `parentId` 创建新版本，原文件、原消息和历史任务均保留。

内置柱状图、折线图、饼图、数值散点图和表格；自定义 HTML/CSS/JS 由 AI 编写，最多 1 MiB，使用隔离 iframe，CSP 限制连接和外部资源加载。作品可按用户要求导出为自包含 HTML，图表同时保存 SVG、CSV 和 JSON。

App 携带全局 skill、运行说明和交互模板；`visualize_templates` 返回可改写示例与 `window.mossVisualization` 协议。模型可以按任务生成 UI，不局限于固定模板。生成后作品完整文件最多 2 MiB，超限报错。

后端、AI 工具与 CLI skill 使用同一任务数据；无需额外模型账号，复用主会话。支持通用 Node 平台包，实测 macOS ARM64。Moss 打包清单可自动带上本 App，源码仍保留在本仓库。

验证：`bun run --cwd apps/visualize test`，`node scripts/package-app.mjs --app moss.visualize`；真实打包后端与生产版组件集成验证：在 Moss 的 `ui` 目录运行 `bun run test:visualization`。此验证使用浏览器和测试传输，不冒充真实模型完整会话。

技能保留 Codex visualize 的主要创作规范，使用中文并适配 Moss 接口；并非逐字翻译。能力差异明确记录在 skill 的 references/adaptation.md。
