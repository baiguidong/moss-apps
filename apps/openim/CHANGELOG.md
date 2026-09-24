# Changelog

## 0.2.7 - 2026-09-24

- 接管 `SIGTERM` / `SIGINT`，修复 OpenIM 原生库在退出时触发 Node 信号循环、残留进程并占满 CPU 的问题。
- 退出清理只执行一次；SDK 清理失败或超过 4 秒时退出，避免关闭流程无限等待。

## 0.2.6 - 2026-09-24

- 直接引用 Moss Core 的 App SDK 2.2，文件、截图、下载和外链改用 `moss.platform/v1` 与 `platform:*` 权限。
- 要求 Host API 2.2，避免安装到仍使用旧 Desktop 协议的宿主。

## 0.2.5 - 2026-09-23

- 移除页面导航位置声明，由 Moss 在 App 启用后自动加入“更多”。
- SDK 忽略旧包的位置字段，保留页面路由和设置入口。

## 0.2.4 - 2026-09-23

- 适配 Moss 的单进程 App 运行约定，Manifest 不再声明实例模式。
- 同步 App SDK，移除多实例创建和删除接口，保留已有配置与状态接口。

## 0.2.3 - 2026-09-23

- 移除 Backend target 声明和运行时 target 分支，App 仅使用隐式 Desktop 运行环境。

## 0.2.2 - 2026-09-23

- 要求 Host API 2.1，避免缺少 `moss.openim/v1` 的旧版 Moss 被误判为兼容。
- OpenIM App 恢复为仅 Desktop 运行，不再要求安装或启用同 App 的 Server Backend。
- 用户供应、Token 签发、群聊准备、权限回调和停用处理由 Moss Server OpenIM integration 负责。
- Desktop Backend 通过受控 Host 能力访问服务端管理接口，App 不接触 Moss 登录凭据或 OpenIM 管理密钥。
- Manifest 按 Desktop target 声明 Host 协议，并从 App SDK 使用正式的 OpenIM 协议常量与校验契约。

## 0.2.1 - 2026-09-22

- Server Backend 改为组织级共享实例，OpenIM 管理密钥只由管理员配置一份；普通组织成员的 Action 仍使用本人 Moss 身份。
- 修复初始化状态上报导致握手失败，并支持用户停用事件立即撤销全部 OpenIM 平台会话。
- Desktop 在 Moss Server 登录信息变化时重启并登出旧 OpenIM 会话，避免跨账号复用 Token。
- 通讯录按页传输，拖拽和粘贴文件使用有界分块写入，不再超过 1 MiB Backend IPC 限制。
- Server 实例配置重新出现在 App 管理页，可编辑 API、WebSocket 地址和管理密钥。

## 0.2.0 - 2026-09-22

- 升级到 Host API 2，删除 `moss.openim/v1` 和旧 Channel API 依赖。
- OpenIM Node SDK、Koffi 与各平台原生库迁入 App Backend，Core 不再提供原生桥。
- Server Backend 通过通用 Account API 完成身份、目录、用户供应与 Token 签发；Desktop 通过 Remote API 调用同 App Server Action。
- 文件、截图、下载和外链迁移到通用 Desktop API；自动回复、Session 与 Turn 统一使用 Agent API。
- App 运行逻辑不再依赖 Moss webhook 和 OpenIM 专用系统设置；OpenIM Server 部署继续由 `moss/deploy/im` 维护。

## 0.1.5 - 2026-09-22

- 自动回复防回环标识由 App 自己定义并通过通用消息扩展字段传递，Host 不再包含自动回复业务规则。

## 0.1.4 - 2026-09-22

- Agent 接管并处理收到的私聊后，将对应 OpenIM 会话标记为已读。

## 0.1.3 - 2026-09-22

- 将 OpenIM 的账号级默认策略作用域留在 App 内，通过通用 Agent 参数传给 Moss Core。
- 外部消息沿用固定 Moss Session，并以普通用户消息写入会话；渠道安全规则只在 Session 系统提示中注入。
- 修复“允许全部工具”被解析为空工具集的问题，避免自动回复只承诺处理却无法实际调用工具。

## 0.1.2 - 2026-09-22

- OpenIM 启动或运行中断网时直接展示消息/通讯录工作区，仅在顶栏显示连接状态并自动重试，不再进入独立的连接错误页。
- 临时连接故障不再登出账号或清空当前会话、联系人和已加载消息。
- 自动回复消息携带来源标记，另一端不会再次触发 AI 自动回复，避免双端 AI 无限对话。

## 0.1.1 - 2026-09-21

- 修复 App 读取 Host 主题字段错误导致 Moss 为亮色时即时消息仍显示暗色的问题。
- 同步 Moss 的系统主题变化以及默认、网格、圆点和渐变背景风格。

## 0.1.0 - 2026-09-21

- 将 Moss Desktop 的 OpenIM 即时消息界面迁入独立 App。
- 增加按权限校验的原生 SDK、文件、媒体与外链桥。
- 增加默认策略和每联系人独立的人工回复、AI 草稿审核、AI 自动回复设置。
- 增加 Agent、Tool、Skill、Connector、操作权限及固定/轮换/独立会话设置。
- 增加草稿编辑批准、人工接管、上下文重置、后台重连和幂等投递重试。
- 默认策略、联系人策略、Turn 和 Agent 会话按当前 OpenIM 账号隔离，账号切换不会串用上下文。
- 账号切换会关闭旧账号的搜索、转发、预览和编辑状态，并丢弃旧事件及异步查询结果。
- “允许全部 Connector”会在执行时同步当前启用项；正式启用且授权的 App 才能申请音视频权限。
- 文件型原生 SDK 调用只接受用户选择、截图或 App 私有缓存中的文件。
- 同一联系人即使使用“每条消息新会话”也保持严格串行，人工接管可阻止尚未投递的自动回复。
