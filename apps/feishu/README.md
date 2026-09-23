# Moss 飞书 App

`moss.feishu` 是一个只处理个人私聊的轻量消息通道。飞书消息进入 Moss 的固定会话，Agent 完成后以普通消息返回结果。

## 行为边界

- 只接收已配对或白名单用户的 `p2p` 私聊，群聊直接忽略。
- 普通文本始终自动调用 AI；首次消息创建一条专用 Moss 会话，之后只复用它，不会绑定或切换到普通桌面会话。
- 不提供会话查看、搜索、新建、切换或停止入口；类似 `/new`、`/stop` 的文本也只是普通聊天内容。
- 不提供卡片回复、流式卡片、机器人菜单、手机端审批或主动通知。
- 不读取或上传图片、文件等消息资源；附件消息只返回“不支持”的文本提示。
- 不提供人工接管、草稿审核、仅 @ 回复、成员级回复策略或 Agent 选择。

App 只通过通用 `moss.agent/v1` Host API 创建 Turn、接收结果并确认投递；初始化阶段可以完成默认 Binding 更新和状态上报，再在飞书长连接就绪后完成 Backend 握手。飞书事件映射、配对、去重和回复发送都留在 App 内。

飞书 Backend 仅随 Moss Desktop 运行，Manifest 不声明运行位置。客户端退出或设备关机后，飞书长连接不再在线。Backend 通过 Host 提供的 `moss.agent/v1` 协议调用 Agent 能力，不支持部署到 Moss Server。

## 飞书开放平台配置

创建企业自建应用并添加机器人能力。在“权限管理”中只开通以下 3 项：

| 权限名称 | Scope | 用途 |
| --- | --- | --- |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收私聊消息 |
| 以应用的身份发消息 | `im:message:send_as_bot` | 回复用户 |
| 获取与发送单聊、群组消息 | `im:message` | 使用消息发送接口 |

事件配置选择“使用长连接接收事件”，只订阅 `im.message.receive_v1`，不需要配置资源权限、卡片权限、卡片回调或机器人菜单。

权限和事件发生变化后，需要在飞书开放平台创建并发布新版本，并确认应用可用范围包含实际用户。

## Moss 配置

在 `Apps -> 飞书 -> 打开` 中填写：

| 配置项 | 是否必填 | 说明 |
| --- | --- | --- |
| `App ID` | 必填 | 飞书应用凭证，通常以 `cli_` 开头 |
| `App Secret` | 必填 | 与 App ID 对应的密钥 |
| `Encrypt Key` | 长连接不填 | 仅公网回调加密模式使用 |
| `Verification Token` | 长连接不填 | 仅公网回调验签模式使用 |
| 允许的用户 ID | 可选 | 可填写 `open_id` 白名单，也可以使用配对码 |

保存后等待状态显示“飞书长连接已就绪”，再生成配对码并在飞书中私聊机器人发送。

## 执行安全

“执行权限”页只保留：

- 工具确认策略。
- Tool、Skill、Connector 白名单。

这些限制由 Moss Core 在 Session Runtime 和工具调用层执行。飞书手机端不显示授权卡片；需要交互确认的操作在 Moss 客户端处理。

App ID 和白名单保存在 App instance 配置中，配对关系保存在该实例的私有数据目录。App Secret、Encrypt Key 和 Verification Token 写入 Moss 加密凭据存储，配置页只会收到掩码。Agent system prompt、模型密钥和 Connector 凭据不会下发给飞书 App。

## 验收

- [ ] 飞书应用只开通上述 3 项 Scope。
- [ ] 长连接事件只订阅 `im.message.receive_v1`。
- [ ] 未配置机器人菜单和卡片回调。
- [ ] Moss 显示“飞书长连接已就绪”，并完成私聊配对。
- [ ] 连续发送多条普通文本，均进入同一个固定 Moss 会话并收到普通消息回复。
- [ ] 群聊消息被忽略，附件消息收到不支持提示。
- [ ] 手机端没有会话列表、新建、切换、停止、审批或卡片入口。
- [ ] 重启 Moss 后自动恢复长连接、配对关系和固定会话映射。

## 开发

```bash
cd apps/feishu
bun install
bun test
bun run check
bun run build
```

`bun run start` 只能由 Moss Host 通过 IPC 启动，不能作为独立机器人进程运行。
