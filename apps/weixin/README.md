# 微信

在 Moss 的「插件 → Apps」中打开微信，用个人微信扫码并在手机上确认。App 自动保存账号与登录凭据，可通过「查看当前配置」查看账号 ID 和连接状态。重新扫码可更换账号。外层 App 启用开关控制连接。

「仅最终回复」发送最终消息。「处理提示和最终回复」使用微信正在输入状态，微信未显示输入状态时沿用渠道的超时占位提示。此模式可独立开启思考状态和工具调用提示。可选择回复助手，使用默认工具，或按功能、App 分组选取工具并保存。每个账号和联系人分别绑定 Moss 会话，附件向 Moss 传递类型和文件名。

扫码、iLink 消息协议和微信图标来自 MossWork 提交 `3ddc9f21588c3a33b5860e6fbbda51eea4d2af6f`。Moss 端使用内置 Python，根据锁定的依赖启动网关。登录 Token 由 Moss 凭据库保存。来源许可见 [MossWork](assets/MOSSWORK-LICENSE) 和 [moss-gateway](assets/MOSS-GATEWAY-LICENSE)。
