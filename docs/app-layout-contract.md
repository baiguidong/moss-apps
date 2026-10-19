# App 头部、空间利用与 Moss 风格

2026-10-19。检查了仓库的 24 个自定义 App、6 个配置型 MCP App 及共用设置页。Moss 外框已经提供应用名称、简介、迭代、AI 能力和整页刷新；内页重复品牌区会形成两层头部。采用统一分工：外框显示应用身份，内页从业务输入、列表、状态或操作区开始。

## 后续 AI 创建规则

- [SDK 接入说明](app-sdk.md) 与 Core `packages/app-sdk/README.md`、`ui/docs/app-authoring.md` 同步约定布局，无需新增 Manifest 字段或提高最低 Host API。
- App Builder 的创建、迭代、Skill 转换指令和 `builder_inspect guidance` 都携带这条规则，并提供 [内容模板](../apps/app-builder/resources/authoring/index.html)。
- Builder 同时提供 [渲染检查函数](../apps/app-builder/resources/authoring/layout-check.mjs)，验证初始页面不重复 Manifest 名称和简介。用 Node/Playwright 调用 `assertAppContentLayout(appPageOrFrame, manifest)`；仓库的引擎 App 验证已接入同一个函数，并检查实际 Moss 外框中的标题与简介各出现一次。
- 自动检查只能发现相同文本；近义简介、重复操作和排版仍需在带 Moss 外框的普通、窄窗口里目视验收。保留业务标题、无障碍名称和范围明确的操作，不用全局 CSS 隐藏标题或运行时删除 DOM。

## 现有页面

| 页面 | 调整 |
| --- | --- |
| 文档转换、文件清理、代码地图 | 现有源码已隐藏品牌标题；删除残留的 subtitle/icon 接口和旧头部样式，保持业务内容在顶部，引擎检查在底部 |
| 图片、PDF、语音转写 | 清理同样的旧参数；删除底部重复的输入数与完成数 |
| 网页操控、记忆 | 删除品牌区和重复功能简介，设置与重连放到连接状态区，保留记忆图谱和使用说明 |
| 应用构建、Buddy | 去掉品牌头部；刷新项目放到项目列表，Buddy 从功能导航开始 |
| 自测 | 开始/停止按钮放入运行概览，移除重复标题和口号 |
| 调用追踪、审计、即时消息、数据库 | 保留状态、计数与操作，移除应用名、标志和重复介绍 |
| 开发工具、知识库、语义知识库、TAKT | 移除侧栏品牌区，保留分类导航和当前业务标题 |
| 网盘、MCP 管理等加载页面 | 清理加载时闪现的应用名，保留加载状态与失败说明 |
| 飞书、电脑操控、工作流、共用 MCP 设置 | 检查后保留业务配置、服务和对象标题 |

## 验证与生效范围

所有 30 个 App 的仓库校验通过；修改涉及的 21 个 App 完整构建通过，19 个业务组件/共用组件变更涉及的 App 类型或语法检查通过。构建缺失的引擎与模型从既有发行包恢复，并按固定 SHA-256 校验；没有更换版本。

网页操控 5 项、记忆 10 项、调用追踪 2 项浏览器测试通过；自测页面 14 项检查、数据库 10 组窗口布局和 Builder 10 项测试通过。文档转换使用本次构建生成的临时测试包，在隔离 Electron/真实 Core 外框中验证唯一头部、真实 DOCX 转换与预览、导出、CLI 共享结果、部分失败、浅色/深色/窄窗口及重启恢复。

截图：[文档转换](../artifacts/engine-apps/verification/document-converter/light.png)、[网页操控](../artifacts/moss.browser-use/screenshots/0.1.5/light.png)、[记忆窄窗口](../artifacts/moss.memory/screenshots/0.2.1/light-narrow.png)、[自测](../artifacts/app-layout/self-test/light-idle.png)。

本次修改源码、模板和本地构建产物，未发布市场版本或替换用户当前安装包。已安装旧包不会因源码修改自动更新；需通过正常 App 更新流程安装重建版本。临时测试 ZIP 只用于隔离验证，不作为可发布、可恢复源码的交付包。Core SDK 文档修改已同步到 vendored SDK 并更新来源摘要，后续提交应一并固定对应 Core 版本。

## 空间利用与视觉约定（补充迭代）

完整约定现在随 [SDK 布局文档](../vendor/moss-core/packages/app-sdk/ui-layout.md) 一起导出，并进入 Core 作者文档、Builder 创建/迭代/Skill 转换指令和 `builder_inspect guidance`。主要输入、数据、编辑器和结果优先使用首屏及剩余空间；设置、帮助等次要操作并入业务工具栏或分区标题，不能独占空行。采用 Moss 语义颜色、字体和线性图标，默认 12–16 px 页面及区域间距、13–14 px 正文、28–32 px 桌面控件，保留可读性、焦点和必要配置。

Builder 提供可直接改造的 [HTML 模板](../apps/app-builder/resources/authoring/index.html)、[紧凑样式](../apps/app-builder/resources/authoring/ui.css)、[Moss 主题](../apps/app-builder/resources/authoring/theme.css) 和 [主题同步逻辑](../apps/app-builder/resources/authoring/ui.mjs)。输入与结果在宽窗口并列、窄窗口堆叠，设置放入弹层。模板业务按钮保持明确的占位状态，创建实际 App 时必须接入声明的 Action。浅色、深色、系统主题和运行时 appearance 事件都已处理。

现有 [布局检查函数](../apps/app-builder/resources/authoring/layout-check.mjs) 增加 `assertAppWorkspaceLayout(pageOrFrame)`，检查主要区域的位置、页面横向溢出、次要操作独占工具栏；标记必须指向真实业务区域，不能用占位内容通过检查。视觉质量和阅读顺序仍需在 Moss 外框内验收。

此次同步调整：

- Core 共用 MCP 页删除单独的设置头部，将设置、服务检查与连接状态合并，压缩大标题、重复说明和卡片间距。
- 文档转换、文件清理、代码地图使用更宽的工作区和更小的空结果占位；文档转换的排版、引用及高级参数默认折叠，输入与输出格式、转换操作保持可见。
- 图片、PDF、语音转写共用布局收紧边距、卡片与空状态；图片工具在窄窗口改用一行功能选择，保留全部八项功能，避免四行导航挤占预览。

本轮验证独立于上面的首次去重验证：Builder 10 项测试、Core SDK 离线导出 2 项测试通过；Builder、Core MCP 页面及上述六个工作区 App 构建通过。真实 Builder 模板检查了三档尺寸、浅深色、系统主题、长结果、弹层关闭与焦点返回，并验证了重复空工具栏、过高头部和溢出的反例。

隔离 Electron 使用生产 Core 外框和本次构建的测试包，验证文档转换的 DOCX 转换/预览/导出、混合成功与失败结果，以及图片工具的导入、转换、鼠标裁剪、组合参数、预览/导出、窄窗口功能选择和重启恢复。Excel MCP 实际发现 42 个工具，验证缓存恢复、手动刷新、启停状态及三档尺寸的浅深色布局；设置和检查始终共用工具栏。验证夹具也同步外框主题，并加载完整组件样式，避免截图与实际 Moss 配色不一致。

截图：[新建模板](../artifacts/app-layout/compact/template-normal-light.png)、[小尺寸模板](../artifacts/app-layout/compact/template-small-dark.png)、[MCP 公共页](../artifacts/app-capabilities/compact-excel-normal-light.png)、[文档转换](../artifacts/engine-apps/verification/document-converter/light.png)、[图片工具窄窗口](../artifacts/local-task-apps/verification/image-tools/result-narrow.png)。本轮仍只修改源码、SDK/Builder 资源和本地构建，没有替换已安装 App 或发布市场版本。
