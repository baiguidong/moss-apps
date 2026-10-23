# Draw.io 配置型应用

0.1.3 的体验截图与历史本地包位于 [`../../artifacts/moss.drawio/0.1.3/`](../../artifacts/moss.drawio/0.1.3/)。这是由 Moss Core 生成并直接托管的应用，独立安装，无需另装基础 App。

## 查看体验

1. 使用相邻 `~/repo/moss` 当前代码运行 Moss Core（Host API 3.9）。开发模式可在 `~/repo/moss/ui` 执行 `bun run dev`。
2. 在应用管理中导入 [`moss.drawio-0.1.4.zip`](../../artifacts/moss.drawio/0.1.4/moss.drawio-0.1.4.zip)。已有正式客户端需要先更新到包含本次 Core 改动的版本。
3. 打开 Draw.io 设置页；首次打开自动检查 `npx -y @drawio/mcp` 并显示可用工具。
4. 在会话中选择 Draw.io，例如输入“画一个用户登录流程图，包含验证码和异常处理”。打开生成的链接可继续编辑。

页面沿用 Git、Filesystem 的布局和交互：服务状态、检查服务、使用示例、工具详情与搜索、设置弹窗、浅色/深色主题。设置包含服务开关、工具使用范围、排除工具和连接配置，保存后重新检查服务。

“全局可用”表示每个会话都可选用，MCP 进程仍按会话运行时独立。Core 缓存工具目录，实际使用时再建立连接；首次发现目录会短暂启动服务。Draw.io 声明可安全重启，默认空闲 60 分钟回收进程；下次调用自动启动。图表保存在编辑器链接或本地文件中，重启不会删除这些内容。回收时间可在 Moss 设置 → 高级设置 → Agent 与执行中调整。不同会话若访问同一外部文件或远端资源，仍可能互相影响。会话回收由 Moss Core 管理，0.1.3 安装包增加可安全重启声明。

[浅色页面](../../artifacts/moss.drawio/0.1.3/screenshots/drawio-light.png) · [深色页面](../../artifacts/moss.drawio/0.1.3/screenshots/drawio-dark.png) · [设置弹窗](../../artifacts/moss.drawio/0.1.3/screenshots/drawio-settings.png)

会话运行时默认空闲 60 分钟回收、最多保留 15 个；再次发送消息自动恢复原有记录。回收设置、桌面恢复和真实 Draw.io 文件重启验证结果见安装包目录中的 `runtime-recycling-verification.json`、`verification.json` 和[设置截图](../../artifacts/moss.drawio/0.1.3/screenshots/runtime-recycling-settings.png)。

## 源文件

- `app.json`：标识、版本、介绍、使用示例、图标路径和 MCP 启动配置。
- `resources/`：随应用分发的图标及说明。
- 公共 UI：`moss/ui/src/apps/mcp-app-ui/`，随 Core 一起构建。

运行文件包含 `app.moss.json`、`mcp.json`、`definition.json`、图标、README 和校验和，没有应用专用 JS、HTML、CSS 或 Backend。0.1.4 起还包含 `source/` 与 `source-manifest.json`，固定 Core 生成器、依赖锁和配置源码，以便独立重建；正式市场包另附签名。

## 重新生成

在 `~/repo/moss-apps` 执行：

```sh
node scripts/package-app.mjs --app moss.drawio
node scripts/verify-source-package.mjs --app moss.drawio --rebuild
```

输出为 `artifacts/moss.drawio/0.1.4/`。已接入[统一自动发布流程](../../docs/automatic-app-release.md)：配置版本提高并进入 main 后，CI 检查已发布版本，完成签名、重建验证后上架市场。Core 支持已提交并固定到子模块；线上发布结果见仓库 Actions 和应用市场。现有 Git、Filesystem 等 App 仍保留原目录与实现。
