# Moss OpenIM App

Moss 的即时消息 App。OpenIM UI、Node SDK、原生库、平台事件与服务端账号供应均由此 App 持有；Moss Core 只提供 Host API 2 的通用能力。

默认 AI 策略只是联系人模板。每个单聊联系人都可以选择跟随默认值，或完整覆盖回复方式、Agent、Tool、Skill、Connector、操作权限和上下文方式。AI 草稿只在本机审核区展示，批准后才会发送；人工输入或发送消息时会取消尚未投递的 AI 回复。

联系人策略、Turn 和 Agent Session 映射按 owner、App 实例和联系人隔离，保存在 Moss Core 的通用 Agent 存储中；OpenIM SDK 数据、日志、媒体缓存和幂等投递记录保存在 `moss.openim` 的实例数据目录中。拖拽或粘贴的附件会先复制到 App 私有媒体缓存，原生 SDK 不能读取未经用户选择或缓存授权的任意路径。App 不读取 Moss 登录 Token、模型密钥或 Connector 凭据。

Desktop Backend 通过 `moss.remote/v1` 调用同一 App 的 Server Backend；Server Backend 再通过 `moss.account/v1` 获取当前用户身份和组织目录，并负责 OpenIM 用户供应及 Token 签发。自动回复只使用 `moss.agent/v1`，文件、截图、下载和外链只使用 `moss.desktop/v1`。Core 中没有 OpenIM 专用协议或接口。

## 本地验证

```bash
bun install
bun run check --app moss.openim
bun run test --app moss.openim
bun run build --app moss.openim
bun run package --app moss.openim
```

聊天客户端和自动回复运行在 Desktop，账号供应运行在 Server；单聊支持 AI 策略，群聊保持人工处理。App 构建会把 Koffi 和 OpenIM 各平台原生库放入 Backend 产物，Host 不再携带任何 OpenIM 运行依赖。

OpenIM Server 属于与 Moss Server 一起部署的服务端基础设施，部署脚本仍由 `moss/deploy/im` 维护，不包含在 App 的构建或发布包中。本仓库只维护 OpenIM App 的 Desktop 与 Server Backend 运行逻辑。
