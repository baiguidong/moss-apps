# MCP 能力入口、缓存与按需连接

2026-10-19。此次修改在相邻 `moss` Core 仓库实现，应用无需各自增加工具缓存。

- “MCP 工具待发现”改为中性的“AI 能力”；有上次成功清单就直接显示工具数量，卡片图标和按钮缩小为版本信息行的尺寸。
- 清单按实例持久保存；重启或再次打开页面不必先启动 MCP。弹层标明上次获取时间，失败保留旧清单，仍可手动刷新。
- 实际使用时连接并刷新工具目录，同一连接的并发请求只刷新一次。缓存只用于展示，不替代执行参数 schema、授权或真实连接状态。
- MCP 内置设置页取消打开时的额外服务检查；检查按钮仍可验证，保存设置仍验证。删除“检查后才能使用”的引导及重复的应用简介。

详细约定在 Core `ui/docs/app-mcp-catalog.md`。42 项自动化测试通过，涵盖 Host 持久化、运行时首次调用/重新连接、能力摘要及选择器。真实 Excel 的 42 个工具已通过隔离 Desktop 验证，记录见 [验证结果](../artifacts/app-capabilities/excel.json) 和 [重启缓存截图](../artifacts/app-capabilities/excel-cached-tools.png)。Draw.io 完整 Desktop 回归也验证了手动检查、设置保存、故障恢复、筛选与启停。

[卡片样式预览](../artifacts/app-capabilities/cards.png) 使用生产 AppsPanel 与生产样式、示例元数据，展示无清单、已有清单和 CLI skill 三种状态。

复现：`node scripts/verify-app-capabilities.mjs`，默认使用相邻 Core，或用 `MOSS_CORE_ROOT` 指定。须先构建 Core 的运行模块与内置 MCP 页面，并备好 Excel 测试包。旧的 [Office MCP 交付记录](office-mcp-app-delivery.md) 中“首次自动检查”描述的是当时行为，现已改为按使用连接。

未替换用户当前安装的 Moss，也未发布市场版本。已有安装需通过正常 Core 更新流程生效。此前的跨 App 标题去重与生成规范见 [App 布局约定](app-layout-contract.md)。
