# Moss OpenIM App

Moss 的即时消息 App。它迁移了 Desktop OpenIM 体验，并通过 Moss 提供的受控原生桥连接 OpenIM SDK。

默认 AI 策略只是联系人模板。每个单聊联系人都可以选择跟随默认值，或完整覆盖回复方式、Agent、Tool、Skill、Connector、操作权限和上下文方式。AI 草稿只在本机审核区展示，批准后才会发送；人工输入或发送消息时会取消尚未投递的 AI 回复。

联系人策略、Turn 和 Agent Session 映射按“当前 OpenIM 账号 + 联系人”隔离，保存在 Moss Core 的本机 SQLite 数据库中；OpenIM SDK 数据、日志、媒体缓存和幂等投递记录保存在 `moss.openim` 的实例数据目录中。拖拽或粘贴的附件会先复制到 App 私有媒体缓存，原生 SDK 不能读取未经用户选择或缓存授权的任意路径。App 不读取 Moss 登录 Token、模型密钥或 Connector 凭据。

## 本地验证

```bash
bun install
bun run check --app moss.openim
bun run test --app moss.openim
bun run build --app moss.openim
bun run package --app moss.openim
```

首期只在 Desktop 运行，单聊支持 AI 策略，群聊保持人工处理。App ZIP 不携带平台原生库；macOS/Windows 对应的 OpenIM 原生库由兼容版本的 Moss Host 提供，因此同一 App 版本可以由市场按兼容平台分发。
