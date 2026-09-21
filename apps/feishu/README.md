# Moss 飞书 App

该目录包含完整的 `moss.feishu` App 包、飞书传输实现、配置页面与测试，目录边界按后续独立仓库迁移设计。

## 当前方案摘要

当前真实链路由客户端选择运行位置：

```text
Moss App Settings
  -> moss.feishu instance config + encrypted secrets
  -> 本机：App Runtime -> moss.channel/v1 -> Desktop session
  -> Server：托管 API -> Feishu Adapter -> Moss Server session
```

注意：

- Desktop 的平台配置和配对由 `moss.feishu` App 管理；迁移期仍兼容 `Settings -> IM 接入`
- Server 管理后台不提供飞书凭据配置；Desktop 只在选择 Server 运行时推送完整配置快照
- Desktop 会先停止另一端再启动目标端，避免本机与 Server 同时连接同一个飞书应用
- Server 托管实例在 Desktop 退出后继续运行，并在 Server 重启后自动恢复
- Desktop App Backend 使用 `moss.channel/v1`；旧 Server 托管路径暂由版本化进程 IPC 回退
- 紧急回退可在启动 Moss 前设置 `MOSS_FEISHU_LEGACY_ADAPTER=1`；移除该变量后会恢复此前启用的 App 实例

## 目录边界

`src/backend` 不导入 Desktop、Session 或 Project 内部模块。它只依赖飞书 SDK、App SDK 和目录内的传输/卡片代码；身份绑定、会话执行、通知、决策与幂等账本仍由 Moss Core 通过 `moss.channel/v1` 提供。

Desktop 启动时会将旧 `settings.json.adapters.feishu` 配置复制到默认 App 实例。`appSecret`、`encryptKey` 和 `verificationToken` 写入加密凭据存储；只有 App Backend 初始化时能够收到明文。飞书长连接成功建立后才写入迁移标记，失败则停用 App 并启动旧 Adapter。

## 飞书应用配置

Moss 使用企业自建应用的机器人能力和长连接接收事件。个人飞书账号如果看不到权限管理、事件订阅或版本发布入口，需要先加入允许创建企业自建应用的组织，并由飞书管理员审批和发布应用。

### 权限清单

在飞书开发者后台的 `权限管理` 中开通以下权限。为了避免消息能接收但不能回复、卡片能发送但不能更新等不完整状态，建议一次性开通全部 5 项。

| 权限名称 | Scope | Moss 用途 | 必要性 |
| --- | --- | --- | --- |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收手机端私聊消息 | 基础必需 |
| 以应用的身份发消息 | `im:message:send_as_bot` | 回复用户、主动推送消息中心通知和会话卡片 | 基础必需 |
| 获取与发送单聊、群组消息 | `im:message` | 回复消息、更新已发送卡片和处理完整消息能力 | 基础必需；当前 Moss 仍只处理私聊 |
| 获取与上传图片或文件资源 | `im:resource` | 上传 Agent 回复中的图片；为消息资源处理提供权限 | 图片消息必需 |
| 创建和更新卡片 | `cardkit:card:write` | 创建 CardKit 卡片实体、流式写入并完成卡片更新 | 流式卡片必需 |

`cardkit:card:write` 缺失时，Adapter 会降级到普通交互卡片并通过消息更新接口刷新内容，不应再发送空白卡片；但不会有完整的 CardKit 流式体验。

当前实现不需要以下权限：群聊中 `@` 机器人消息、读取所有群消息、通讯录、审批、日历。Adapter 会直接忽略群聊消息，不要为了 Moss 扩大应用权限范围。

相关飞书官方接口文档：

- [接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)和[回复消息](https://open.feishu.cn/document/server-docs/im-v1/message/reply)
- [上传图片](https://open.feishu.cn/document/server-docs/im-v1/image/create)、[上传文件](https://open.feishu.cn/document/server-docs/im-v1/file/create)和[获取消息资源](https://open.feishu.cn/document/server-docs/im-v1/message/get-2)
- [创建 CardKit 卡片实体](https://open.feishu.cn/document/cardkit-v1/card/create)和[流式更新卡片](https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview)

### 事件与回调

飞书把“事件”和“回调”放在两个独立页签中，不能都在“添加事件”里搜索。按以下路径分别配置，不需要填写公网请求地址：

1. 打开 `开发配置 -> 事件与回调 -> 事件配置`。
2. 将订阅方式设为“使用长连接接收事件”并保存。
3. 点击“添加事件”，搜索并添加“接收消息”（`im.message.receive_v1`）和“机器人自定义菜单”或“机器人菜单”（`application.bot.menu_v6`）。
4. 切换到 `开发配置 -> 事件与回调 -> 回调配置`。
5. 将回调订阅方式设为“使用长连接接收回调”并保存。
6. 点击“添加回调”，搜索中文名称“卡片回传交互”，添加新版 `card.action.trigger`。

不要选择“消息卡片回传交互（旧）”或 `card.action.trigger_v1`，旧版不适用于当前长连接实现。部分飞书租户在保存长连接订阅方式时会检查应用是否在线；遇到“应用未建立长连接”时，先在 Moss 中保存有效的 `App ID` 和 `App Secret`，确认 Adapter 已连接，再回到飞书后台保存。

| 类型 | 标识 | Moss 用途 | 必要性 |
| --- | --- | --- | --- |
| 事件 | `im.message.receive_v1` | 接收用户私聊消息 | 基础必需 |
| 事件 | `application.bot.menu_v6` | 响应手机端机器人自定义菜单 | 客户菜单必需 |
| 回调 | `card.action.trigger` | 处理会话选择、搜索、新建、允许和拒绝等卡片操作 | 交互卡片必需 |

### 手机端客户菜单

Adapter 已接入 `application.bot.menu_v6`，并提供会话中心卡片。菜单不在“权限管理”页面。先确认应用已经添加机器人能力，然后进入 `应用能力 -> 机器人 -> 机器人配置`，找到“机器人自定义菜单”。创建“推送事件”类型菜单，并使用以下事件键：

| 菜单名称 | 事件键 |
| --- | --- |
| 会话中心 | `moss.sessions` |
| 新建会话 | `moss.new_session` |
| 停止执行 | `moss.stop` |

飞书最多配置 3 个机器人自定义菜单，因此不单独配置“当前会话”；“会话中心”卡片顶部已经显示当前会话。Adapter 仍兼容 `moss.current` 事件键，但它不是必配菜单项。

配置完成后，手机端用户可以通过菜单和卡片按钮完成分类、分页、搜索、切换和新建会话，不需要输入会话 ID 或斜杠命令。旧命令仍保留用于兼容。菜单事件格式见飞书官方[机器人自定义菜单事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v6/bot/events/menu)。

如果“机器人配置”中没有“机器人自定义菜单”，依次检查：当前应用是否为企业自建应用、是否已添加机器人能力、当前账号是否具有应用管理员或开发者权限。个人账号所在租户不开放企业自建应用能力时，该入口不会出现。

### 发布检查

权限、事件、回调或菜单发生变化后，必须在飞书开发者后台创建并发布新版本；仅保存草稿不会对手机端生效。发布后检查应用可用范围包含实际验收用户，然后在 Moss 的 `设置 -> IM 接入` 中保存 `App ID` 和 `App Secret`。客户端会按选定的运行位置启动 Adapter 和飞书长连接。

### Moss 客户端配置

打开飞书 App 的设置页（迁移期也可从 `设置 -> IM 接入 -> 飞书` 进入），逐项核对：

| 配置项 | 是否必填 | 填写方式 |
| --- | --- | --- |
| `App ID` | 必填 | 复制飞书应用“凭证与基础信息”中的 App ID，通常以 `cli_` 开头 |
| `App Secret` | 必填 | 复制同一页面的 App Secret |
| `Encrypt Key` | 长连接不填 | 仅开发者服务器回调加密模式使用；Moss 当前使用长连接 |
| `Verification Token` | 长连接不填 | 仅开发者服务器回调验签模式使用；Moss 当前使用长连接 |
| 允许的用户 ID | 可选 | 可预先填写 `open_id` 白名单，多个值用逗号分隔；通常留空后使用配对码 |
| 流式卡片 | 可选 | 不影响 Adapter 启动；具备 `cardkit:card:write` 时可使用 CardKit，失败会自动降级 |
| 运行位置 | 必填 | `本机` 随 Desktop 运行；`Moss Server` 在 Desktop 退出后继续运行，需要先完成远程连接认证 |

保存后，状态应依次变为“Adapter 正在启动”“桥接已连接，正在等待飞书长连接”“飞书长连接已就绪”，状态中会显示当前运行在本机还是 Moss Server。然后在“配对管理”中生成 6 位配对码，在飞书中与机器人私聊发送该配对码；配对成功后，用户会出现在“已配对用户”列表中。

### 配置检查清单

- [ ] 应用类型是企业自建应用。
- [ ] 已添加机器人能力。
- [ ] 5 项 Scope 已开通：`im:message.p2p_msg:readonly`、`im:message:send_as_bot`、`im:message`、`im:resource`、`cardkit:card:write`。
- [ ] 事件配置使用长连接，并已添加 `im.message.receive_v1`、`application.bot.menu_v6`。
- [ ] 回调配置使用长连接，并已添加新版 `card.action.trigger`。
- [ ] 机器人自定义菜单包含 3 个 Moss 事件键：`moss.sessions`、`moss.new_session`、`moss.stop`。
- [ ] 已创建并发布新版本，应用可用范围包含验收用户。
- [ ] Moss 已填写并保存 `App ID`、`App Secret`，状态显示“飞书长连接已就绪”。
- [ ] 已生成配对码并在飞书私聊机器人完成配对。

### 手机端功能验收

按顺序执行以下用例；前一项失败时先不要继续，按对应配置项排查。

1. **长连接与配对**
   - 操作：启动 Moss，打开 `设置 -> IM 接入`，生成配对码并在飞书私聊机器人发送。
   - 预期：Moss 显示“飞书长连接已就绪”；机器人回复配对成功；该用户出现在“已配对用户”中。
2. **会话中心入口**
   - 操作：发送“会话中心”，再点击机器人菜单“会话中心”。
   - 预期：两种入口都返回会话中心卡片；顶部显示当前会话；正文提供“最近 / 飞书 / 项目”分类，全程不显示会话 ID。
3. **会话查询与分页**
   - 操作：切换分类，使用卡片内搜索框搜索会话；会话超过 5 个时点击上一页或下一页。
   - 预期：分类、搜索和分页结果正确，点击按钮不会持续转圈或提示回调失败。
4. **新会话**
   - 操作：点击菜单或卡片中的“新建会话”，随后发送一条普通消息。
   - 预期：手机端提示新会话已成为当前会话；Moss 桌面端出现归类到“飞书”的新会话；回复返回同一飞书私聊。
5. **老会话切换**
   - 操作：在会话中心选择一个已有会话，发送一条容易辨认的消息。
   - 预期：手机端提示已切换；后续消息进入选中的 Moss 会话，而不是固定进入之前的会话。
6. **普通回复与工具执行卡片**
   - 操作：发送一个会触发工具调用的请求。
   - 预期：手机端立即显示包含当前会话名称的“正在处理”卡片；执行期间显示工具状态；完成后显示最终答复，不出现空白框。
7. **停止执行**
   - 操作：在任务执行期间点击机器人菜单“停止执行”。
   - 预期：当前执行收到停止信号，排队消息被取消时会显示取消数量，不影响其他会话。
8. **消息中心主动推送**
   - 操作：在 Moss 中产生一条允许推送到移动端的消息中心通知。
   - 预期：无需先从手机发送消息，飞书会主动收到标题和安全摘要；同一通知不会重复推送。
9. **允许与拒绝闭环**
   - 操作：分别产生两次需要确认的工具调用或计划确认，在手机端选择“允许一次”和“拒绝”。
   - 预期：允许只恢复对应会话的对应操作；拒绝只终止对应操作；桌面消息中心与飞书卡片都更新为最终状态；重复点击不会重复执行。
10. **重启恢复**
    - 操作：退出并重新启动 Moss，不重新保存飞书配置，然后再次打开会话中心并发送消息。
    - 预期：Adapter 自动启动并恢复长连接；配对关系和当前会话绑定仍然有效；待推送消息会继续重试。

验收失败时优先按现象定位：收不到任何消息检查 `im.message.receive_v1`；能收不能回检查消息 Scope；按钮无响应检查新版 `card.action.trigger`；菜单无响应检查 `application.bot.menu_v6` 和事件键；回复不流式检查 `cardkit:card:write`。

## 快速启动

```bash
cd apps/feishu
bun install
bun run build
```

`bun run start` 只用于由 Moss Host 通过 IPC 启动 Backend，不能作为独立机器人进程直接运行。

## 开发

### 运行测试

```bash
cd apps/feishu
bun test
bun run test:common
bun run test:feishu
```

### 目录结构

```text
apps/feishu/
├── app.moss.json
├── schemas/
├── src/index.html         # App 配置页面
├── src/backend/common/    # Channel bridge 与传输公共代码
├── src/backend/feishu/    # 飞书 SDK、长连接、卡片与消息转换
├── package.json
├── tsconfig.json
└── README.md
```

## 附件收发

飞书 Channel 当前只接收入站文本；入站附件会返回明确提示。

**出站(Claude → 用户):**

Agent 文本里的 markdown 图片引用 `![alt](path|url|data:)` 会被 `ImageBlockWatcher` 识别、上传到 IM 平台,作为独立图片消息发出:

- 飞书: `im.message.create(msg_type='image')` 单发(card 内嵌是后续优化)

非图片类出站（Agent 产出的 PDF、ZIP 等）暂不支持。
