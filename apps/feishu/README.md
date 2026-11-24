# 飞书

从 Moss 桌面「插件」的 App 列表或「常用」进入飞书详情，点「打开」。页面默认显示扫码，可切换到「手动填写」，也可点「查看当前配置」查看已保存的 App ID 和通道设置。外层 App 的启用开关控制飞书长连接。手动配置可通过「检测连接」检查凭据和长连接。

「仅最终回复」只发送回复正文。「处理提示和最终回复」还会在收到的飞书消息上添加处理中表情。
在「处理提示和最终回复」模式下，还可单独开启「显示思考状态」和「显示工具调用提示」。两个开关默认关闭。开启后，飞书可显示模型开始思考的提示，或工具名称和调用状态。此功能需要支持 `turn.progress` 的 Moss 宿主。

已有机器人时，可在扫码页点「保存设置」应用新的回复方式、回复助手和工具范围。默认工具可展开查看。「仅使用所选工具」可搜索内置工具或 App 工具，至少选择一项才能保存。自定义工具范围需要支持 `turn.start.toolAllowlist` 的 Moss 宿主，工具执行仍遵循当前会话的权限规则。

消息收发使用 MossWork 的 `moss-gateway` 飞书渠道。Moss 提供内置 Python，首次连接或检测时按锁文件安装运行依赖。飞书 App Secret、Encrypt Key 和 Verification Token 由 Moss 凭据库保存。

当前 Moss 会话接口接收文本及附件名称和类型。附件内容仍在飞书中查看。

前端的飞书图标、渠道样式和消息网关源码来自 MossWork 提交 `fece50da547452292801937d789518818c155cbc`。扫码使用飞书官方 Node SDK 的同一套设备注册接口，授权后自动保存凭据。来源许可见 [MossWork](assets/MOSSWORK-LICENSE) 和 [moss-gateway](assets/MOSS-GATEWAY-LICENSE)。

开发与检查使用 `node scripts/run-apps.mjs <check|test|build> --app moss.feishu`。后续独立 App 的范围见 [渠道 App 规划](../../docs/channel-apps.md)。
