# 网页操控 · Browser Use

由 Moss Core 统一展示的网页操控 App，不包含独立前端。启用后注册 Playwright MCP，只有实际调用网页自动化工具时才打开浏览器，在对话中完成导航、读取、截图和表单任务。需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.21.0），无需安装 MCP 管理 App。

## 两种使用方式

| 模式 | 使用方式 |
| --- | --- |
| Moss 专用浏览器（默认） | 首次实际操作网页时打开 Chrome for Testing。无需扩展，固定保留网站登录状态，并发或重复连接复用同一个实例。浏览器具有独立应用身份，不占用日常 Chrome 的应用实例。 |
| 日常 Chrome | 安装 [Playwright 官方扩展](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)，允许连接后使用原来的标签页、书签、扩展和登录状态。可在高级设置保存扩展令牌，以免重复确认。 |

连接设置中可随时切换模式。高级场景也可以只连接已有 CDP 服务；CDP 不可用时不会以系统 Chrome 回退启动。日常 Chrome 模式不会通过调试参数重启浏览器或复制用户目录。

自定义 Chrome 可执行文件时，必须同时填写已存在且已安装 Playwright 扩展的用户目录。App 校验并固定选中的现有配置，不创建空白系统 Chrome 目录。

专用模式随平台安装包提供固定版本的 Chrome for Testing，首次实际使用时离线解包，后续复用。启动 Moss、加载工具目录、打开设置或重新连接均不会启动 Chrome，实际网页操作才建立浏览器连接。Playwright MCP 0.0.83 及生产依赖随包提供，无需 npx 或运行时安装 JavaScript 依赖。

默认专用 CDP 为 `http://127.0.0.1:9222`，配置保存在 `~/.moss/browser-profiles/playwright-cdp-9222`。每个端口保留固定目录，重连和浏览器重新打开仍使用同一份登录数据；网站自身过期或要求重新认证时仍需登录。专用模式只启动受管 Chrome for Testing，不启动系统 Google Chrome。

手动退出专用浏览器后，原对话下一次网页操作会自动重新打开相同配置。恢复只发生在 CDP 建立连接时，不自动重试已发送的点击或提交；端口被其他服务占用时停止连接并报错。

输出目录为 `~/.moss/artifacts/playwright`。工具已就绪表示 MCP 工具目录可用；专用浏览器和日常 Chrome 的实际连接均在网页操作时建立。在插件详情查看工具，点击服务行主动检查 MCP；浏览器连接设置通过右侧面板修改。

关闭 App 页面不停止控制。停用 App 或关闭 MCP 保留浏览器及用户目录。旧的默认本机配置升级到受管专用模式，明确选择的日常 Chrome、CDP 地址和凭据保留。若旧版 Moss 的系统 Chrome 自动化实例仍占用端口，提示用户关闭旧窗口或更换专用端口，不自动终止任何浏览器。

## 开发与验证

在仓库根目录执行：

```sh
bun install
bun run --cwd apps/browser-use check
bun run --cwd apps/browser-use test
node scripts/package-app.mjs --app moss.browser-use
node apps/browser-use/scripts/verify-host.mjs
node apps/browser-use/scripts/verify-browser-startup.mjs
node apps/browser-use/scripts/verify-managed-browser.mjs
node apps/browser-use/scripts/verify-extension.mjs
```

Host 验证使用相邻 Moss 仓库，可用 `MOSS_CORE_ROOT` 指定路径，需已有 `ui/electron-direct.mjs`。使用临时 App 数据和专用浏览器测试目录，不写入已安装 App 的配置。Core 负责表单渲染；字段、条件和读写动作在 Manifest 与 schemas/connection.json 中声明。结果写入 `artifacts/moss.browser-use/verification/<version>/`。

本版本要求 Moss Host API >=3.21.0，展示入口为插件 → 网页操控。旧安装需更新 App 包；查看和保存设置不会启动 MCP 或打开浏览器。
