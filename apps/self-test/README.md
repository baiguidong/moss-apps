# AI 自测

安装后从「设置 → Apps → AI 自测」勾选项目并开始。也可在会话选中 AI 自测 App 后使用自测工具。需要 Moss Host API 3.7。

使用主 Moss 当前真实模型和完全放行授权，启动独立测试实例；已安装 App、配置及个人资源由 Host 复制，业务数据保持隔离。Playwright MCP 随本 App 提供，无需另外安装 Browser Use。

首次准备后复用同一测试实例；支持打开、关闭、同步环境、清理测试数据。停止 AI 操作和测试完成后保留测试窗口及产物，自动打开内嵌截图的 HTML 报告。

清单位于 resources/self-tests/catalog.json，包含现有十项测试，八项默认选择。每轮保存清单、观察和证据，全部标准与截图齐全才能通过。

不迁移旧内置自测数据或配置。运行记录保存在 App 私有目录 runs/，隔离实例由 Host 管理。App 关闭页面后继续执行；停用、撤权或退出 Moss 会回收控制会话和测试进程。

开发：bun run check、bun run test、bun run build。运行依赖随包提供，源码及固定 SDK 随版本保存。
