# App 公共设置

公共代码由 `moss-apps` 内的 App 引用。Moss Desktop 只根据 `contributes.settings` 打开页面，不依赖此包，也不实现 MCP 配置编辑器。

此模块统一提供工具范围（跟随 App 默认、指定会话、全局）、MCP 连接信息与编辑、连接检查、可用工具、启停、浏览器授权。默认范围来自 Manifest 的 `toolScope`，用户覆盖通过 App SDK 的 `moss.host/v1 tools.scope.get/set` 保存，`null` 恢复默认。MCP 操作通过 `moss.mcp/v1`，调用身份和权限由 Host 绑定，不传 App ID。

App 接入：

1. 在 `package.json` 声明 `"@moss/app-settings": "workspace:*"`。
2. 在 `contributes.views` 声明路由 `#/moss-settings`，在 `contributes.settings` 引用该 view。设置项用独立 ID，`order: -1000` 将其作为顶部设置按钮的默认目标。保留 App 原来的配置页和主入口。顶部只为提供工具或 MCP 服务的 App 增加通用设置按钮，与刷新并列；不增加第二行页面标签，不收录 App 自有配置。其他 App 保持原来的设置方式。
3. 声明 `moss.host/v1`，最低 Host API 3.6；MCP App 同时声明 `moss.mcp/v1` 和相应 `mcp:read/manage/connect/auth` 权限。授权仍以实际安装状态为准。
4. 在 App 构建脚本结束时调用 `buildAppSettings(appRoot)`；Vite 开发环境添加 `appSettingsPlugin(new URL('.', import.meta.url))`。

构建产物随 App 打包，包括独立的 JS、CSS 和路由入口。设置页使用 Shadow DOM 隔离样式，关闭后恢复原页面的工作内容。源码导出会携带公共包源码和锁定依赖，可以脱离原仓库重建。

验证：`bun run check`；仓库根目录执行 `bun test ./scripts/app-settings.test.ts`、`node packages/app-settings/tests/browser.mjs`。浏览器验证使用 MCP App 已声明的 Playwright 依赖；可设置 `APP_SETTINGS_SCREENSHOTS` 保存截图。
