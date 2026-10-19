# Moss AI 自测清单

当前版本 0.1.8，共 59 项、10 个模块；默认 31 项，界面检查 41 项。默认范围包含日常界面回归和 2 项真实聊天；工作流、团队、长任务及外部服务按需选择。

每项都能单独勾选。创建数据时使用 `{{runShortId}}` 标识；不能依赖上一项的产物。`requiresModel` 指被测窗口是否调用模型，控制 AI 始终需要主 Moss 模型。

| 模块 | 项目数 | 默认数 |
| --- | ---: | ---: |
| 基础与设置 | 6 | 6 |
| 会话与消息 | 11 | 5 |
| 项目 | 4 | 1 |
| 文件与版本 | 5 | 3 |
| 多格式预览 | 7 | 6 |
| 资源中心 | 4 | 3 |
| Apps | 6 | 1 |
| Agent 与自动化 | 5 | 2 |
| 概览与记忆 | 5 | 4 |
| 扩展能力 | 6 | 0 |

每项包含 `id`、`title`、`group`、`default`、`requiresModel`、`prerequisites`、`steps`、`expected`、`sources` 和 `timeoutSeconds`。`sources` 是 Moss Core 的代码相对路径，便于功能改动时追溯用例；不依赖运行机器存在源码。时间预算为 30–900 秒。清单最多 100 项，整轮按所选预算累加并预留准备时间。

Host 注入 8 个 UTF-8 样例：TXT、Markdown、HTML、CSV、JSON、JavaScript、SVG 和有效的单页 PDF。Office 文件由扩展用例通过真实工具创建，不伪造文件扩展名。

## 代码覆盖映射

| ID | 功能 | 默认 | 代码来源（Core） |
| --- | --- | --- | --- |
| `startup` | 启动与主界面 | 是 | `ui/src/renderer-react/components/chat-area.tsx` |
| `appearance` | 设置与主题保存 | 是 | `ui/src/renderer-react/components/settings-view.tsx` |
| `chat-appearance` | 字体、间距与消息外观 | 是 | `ui/src/renderer-react/components/settings-view.tsx` |
| `settings-navigation` | 设置分区与工具列表 | 是 | `ui/src/renderer-react/components/settings-view.tsx` |
| `runtime-settings` | 执行与性能参数保存 | 是 | `ui/src/renderer-react/components/settings-view.tsx` |
| `memory-settings` | 记忆与压缩策略设置 | 是 | `ui/src/renderer-react/components/settings-view.tsx` |
| `session-switch` | 真实聊天与会话切换 | 是 | `ui/src/renderer-react/components/chat-area.tsx` |
| `chat-response` | 真实模型收发消息 | 是 | `ui/src/renderer-react/components/chat-area.tsx` |
| `chat-stop` | 停止生成与再次发送 | 否 | `ui/src/renderer-react/components/chat-area.tsx` |
| `model-selector` | 会话模型与思考强度选择 | 否 | `ui/src/renderer-react/components/session-effort-selector.tsx` |
| `session-search` | 全局会话搜索与定位 | 是 | `ui/src/renderer-react/components/global-session-search.tsx` |
| `session-info` | 会话信息与统计 | 是 | `ui/src/renderer-react/components/session-info.tsx` |
| `session-rename` | 会话重命名与搜索同步 | 否 | `ui/src/renderer-react/components/app-sidebar.tsx` |
| `message-rendering` | Markdown、代码与表格消息 | 否 | `ui/src/renderer-react/components/chat/assistant-message.tsx`<br>`ui/src/renderer-react/components/markdown/markdown-renderer.tsx` |
| `message-queue` | 生成中排队与后续回复 | 否 | `ui/src/renderer-react/components/chat-area.tsx` |
| `session-fork` | 消息分支与原会话隔离 | 否 | `ui/src/renderer-react/components/chat/fork-session-button.tsx` |
| `permission-selector` | 会话权限模式切换 | 是 | `ui/src/renderer-react/components/permission-mode-selector.tsx` |
| `project-create` | 项目创建、搜索与配置保存 | 是 | `ui/src/renderer-react/components/projects/project-workspace.tsx` |
| `project-resources` | 项目资源配置与保留 | 否 | `ui/src/renderer-react/components/projects/project-resource-picker.tsx`<br>`ui/src/renderer-react/components/projects/project-workspace.tsx` |
| `project-task` | 项目任务执行、筛选与产物 | 否 | `ui/src/renderer-react/components/projects/project-tasks-tab.tsx` |
| `project-decisions` | 项目待决策与用户回答 | 否 | `ui/src/renderer-react/components/projects/project-workspace.tsx` |
| `file-preview` | 工作区文件与预览 | 是 | `ui/src/renderer-react/components/file-tree.tsx` |
| `workspace-refresh` | 工作区刷新与文件定位 | 是 | `ui/src/renderer-react/components/file-tree.tsx` |
| `workspace-version` | 保存工作区版本与历史检索 | 是 | `ui/src/renderer-react/components/workspace-versions.tsx`<br>`ui/src/workspace-versions/workspace-version-service.mjs` |
| `workspace-restore` | 版本差异与文件恢复 | 否 | `ui/src/renderer-react/components/workspace-versions.tsx` |
| `attachment-send` | 附件选择、移除与真实读取 | 否 | `ui/src/renderer-react/components/chat-area.tsx` |
| `preview-markdown` | Markdown 文件预览 | 是 | `ui/src/renderer-react/components/preview/viewers/MarkdownViewer.tsx` |
| `preview-html` | HTML 文件预览 | 是 | `ui/src/renderer-react/components/preview/viewers/HTMLViewer.tsx` |
| `preview-csv` | CSV 表格与字段内容 | 是 | `ui/src/renderer-react/components/preview/viewers/ExcelViewer.tsx` |
| `preview-code` | JSON 与代码文件预览 | 是 | `ui/src/renderer-react/components/preview/viewers/CodeViewer.tsx`<br>`ui/src/renderer-react/components/preview/viewers/TextViewer.tsx` |
| `preview-svg` | 图片预览与缩放 | 是 | `ui/src/renderer-react/components/preview/viewers/ImageViewer.tsx` |
| `preview-pdf` | PDF 页面与缩放 | 是 | `ui/src/renderer-react/components/preview/viewers/PDFViewer.tsx` |
| `preview-office` | Word、Excel、PPT 预览 | 否 | `ui/src/renderer-react/components/preview/viewers/WordViewer.tsx`<br>`ui/src/renderer-react/components/preview/viewers/ExcelViewer.tsx`<br>`ui/src/renderer-react/components/preview/viewers/PPTViewer.tsx` |
| `skills-hub` | 技能列表、搜索与详情 | 是 | `ui/src/renderer-react/components/skill-hub-view.tsx` |
| `experts-hub` | 专家列表、搜索与详情 | 是 | `ui/src/renderer-react/components/expert-hub-view.tsx` |
| `connectors-hub` | 连接器列表与授权状态 | 是 | `ui/src/renderer-react/components/connector-hub-view.tsx` |
| `resource-selection` | 会话资源选择与取消 | 否 | `ui/src/renderer-react/components/composer-resource-selection-area.tsx` |
| `apps-list` | 继承应用与分类筛选 | 是 | `ui/src/renderer-react/components/apps-panel.tsx` |
| `app-launch` | App 打开、返回与设置入口 | 否 | `ui/src/renderer-react/components/apps-panel.tsx` |
| `app-toggle` | App 停用、启用与入口同步 | 否 | `ui/src/renderer-react/components/apps-panel.tsx` |
| `app-versions` | App 版本与运行实例详情 | 否 | `ui/src/renderer-react/components/apps-panel.tsx` |
| `app-tool-scope` | App 工具会话选择范围 | 否 | `ui/src/renderer-react/components/settings-view.tsx`<br>`ui/src/renderer-react/components/app-mcp-tool-rows.tsx`<br>`ui/src/renderer-react/components/composer-resource-selection-area.tsx` |
| `app-marketplace` | 应用市场搜索与分类 | 否 | `ui/src/renderer-react/components/app-marketplace-panel.tsx` |
| `workflow-demo` | 真实工作流演示任务 | 否 | `ui/src/renderer-react/components/composer-resource-selection-area.tsx` |
| `agent-team-demo` | 真实 Agent Team 协作任务 | 否 | `ui/src/renderer-react/components/agent-teams-workbench.tsx` |
| `agent-manager` | 自定义 Agent 创建与编辑 | 是 | `ui/src/renderer-react/components/agent-manager.tsx` |
| `cron-list` | 定时任务位置与状态 | 是 | `ui/src/renderer-react/components/cron-view.tsx` |
| `cron-execution` | 定时任务创建、暂停与执行 | 否 | `ui/src/renderer-react/components/cron-view.tsx` |
| `overview-usage` | 用量概览与统计切换 | 是 | `ui/src/renderer-react/components/overview-view.tsx` |
| `resource-monitor` | 运行资源与进程监控 | 是 | `ui/src/renderer-react/components/resource-monitor-view.tsx` |
| `memory-overview` | 记忆范围与条目浏览 | 是 | `ui/src/renderer-react/components/memory-overview.tsx` |
| `agent-mail` | 协作邮箱列表与详情 | 否 | `ui/src/renderer-react/components/agent-mail-view.tsx` |
| `notifications` | 消息中心通知与返回 | 是 | `ui/src/renderer-react/components/notification-center.tsx` |
| `browser-panel` | 浏览器面板与页面导航 | 否 | `ui/src/renderer-react/components/browser-panel.tsx` |
| `session-terminal` | 会话终端与工作区 | 否 | `ui/src/renderer-react/components/session-terminal-actions.tsx` |
| `remote-session` | 远程会话连接与文件浏览 | 否 | `ui/src/renderer-react/components/workspace-selector.tsx` |
| `web-search` | 真实网页搜索与来源 | 否 | `ui/src/renderer-react/components/settings-view.tsx` |
| `image-generation` | 图片生成与产物预览 | 否 | `ui/src/renderer-react/components/preview/viewers/ImageViewer.tsx` |
| `computer-use` | 原生电脑操作与授权状态 | 否 | `ui/src/renderer-react/components/computer-use.tsx` |

## 执行边界

51 项固定操作（包含全部 31 项默认用例）由程序执行并保存待核对观察，AI 每批最多 3 项使用新会话核对首轮附带图片后提交结论；证据不足先 inspect，仅该项交给浏览器诊断。预设 CDP 脚本仅通过可见 UI 操作和只读 DOM 验证。出错时返回部分证据，控制 AI 检查当前状态后继续；不重放已发送消息。截图中的视觉标准仍需控制 AI 核对，不把 DOM 标记存在直接等同于视觉通过。

缺少 App、账号、网络、模型能力或原生权限时标记 `blocked` 并解释缺失条件；代码已经实现但实际行为错误时标记 `failed`。全部 expected 都有实际观察且本轮截图存在才允许 `passed`。仅浏览空状态的用例不代表真实业务写入或有数据详情已经验证。

外部连接器、协作邮箱与远程会话只读；不发送业务消息。原生电脑操作和系统终端依赖对应运行环境，CDP 不能代替 OS 能力。安装升级、跨平台打包、后端内部协议和故障注入继续由 Core 自动化测试覆盖，本清单不宣称穷尽所有代码分支。

修改后在 App 目录运行 `bun test tests`、`bun run check`、`bun run build`，再运行 `node tests/ui.browser.mjs <证据目录>`。真实 CDP 和模型链路由 Core 安装验收检查。每轮保存清单快照、SHA-256、观察、截图、逐项时间和报告。
