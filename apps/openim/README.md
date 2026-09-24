# Moss OpenIM App

Moss 的即时消息 App。OpenIM UI、Node SDK、原生库和平台事件由此 App 持有；组织级账号供应、Token 签发和权限回调由 Moss Server 的 OpenIM integration 负责。

默认 AI 策略只是联系人模板。每个单聊联系人都可以选择跟随默认值，或完整覆盖回复方式、Agent、Tool、Skill、Connector、操作权限和上下文方式。AI 草稿只在本机审核区展示，批准后才会发送；人工输入或发送消息时会取消尚未投递的 AI 回复。

联系人策略、Turn 和 Agent Session 映射按 owner、App 实例和联系人隔离，保存在 Moss Core 的通用 Agent 存储中；OpenIM SDK 数据、日志、媒体缓存和幂等投递记录保存在 `moss.openim` 的实例数据目录中。拖拽或粘贴的附件会先复制到 App 私有媒体缓存，原生 SDK 不能读取未经用户选择或缓存授权的任意路径。App 不读取 Moss 登录 Token、模型密钥或 Connector 凭据。

Desktop Backend 通过受控的 `moss.openim/v1` Host 能力调用 Moss Server；Moss 登录 Token 和 OpenIM 管理密钥不会进入 App 进程。自动回复只使用 `moss.agent/v1`，文件、截图、下载和外链只使用 `moss.platform/v1`。当前版本要求 Host API 2.2，并使用 `platform:*` 权限。

管理员在 Moss Server 系统设置中配置 OpenIM API URL、WebSocket URL 和管理密钥。切换或退出 Moss Server 账号会重启 Desktop Backend 并登出旧 OpenIM 会话。

## 本地验证

```bash
bun install
bun run check --app moss.openim
bun run test --app moss.openim
bun run build --app moss.openim
bun run package --app moss.openim
```

聊天客户端和自动回复仅运行在 Desktop；Moss Desktop 退出后不继续保持 OpenIM 在线。账号供应由 Moss Server integration 处理。单聊支持 AI 策略，群聊保持人工处理。拖拽或粘贴的大文件分块写入 App 私有缓存。App 构建会把 Koffi 和 OpenIM 桌面平台原生库放入 Backend 产物，Host 不携带 OpenIM SDK 运行依赖。

OpenIM Server 及其 Moss Server integration 属于服务端基础设施，部署脚本由 `moss/deploy/im` 维护，不包含在 App 的构建或发布包中。本仓库只维护 OpenIM Desktop App。
