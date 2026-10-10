# HTTP 调试 App 历史验证记录

> 2026-10-10 起 HTTP 调试已合并到 [开发工具](../apps/devtools/README.md)。以下保留独立应用 0.1.0 的历史结果与路径；当前验证请在 `apps/devtools` 执行。

验证日期：2026-09-28。App：`moss.http-client@0.1.0`，源码目录 `apps/http-client`。

## 检查范围

| 层级 | 验证结果 |
| --- | --- |
| Manifest / 类型 | 全仓库 Manifest 校验和类型检查通过；无额外 Host 权限、单个按需 Backend、HTTP 工具声明为 `write` |
| 自动测试 | 全仓库共 123 项测试通过，其中 HTTP 的 Node 测试 12 组 |
| 编译包 | 无 node_modules 的临时目录中，以 Node 启动编译后的 Backend；实际请求、鉴权、JSON、输入错误、gzip 上限、取消均通过，未产生请求日志或数据文件 |
| 浏览器 | 10 组 Playwright 测试通过；执行构建后的 UI 和真实编译 Backend，仅宿主桥接与存储使用测试适配器 |
| Moss 桌面 | macOS arm64 下 7 组实际集成检查通过：ZIP 安装、Core preload/runtime、HTTP、存储、取消、主题、AI 调用和启停 |
| 构建 | 全仓库构建通过，HTTP 安装包只包含构建结果、Manifest、Schemas、图标、README 和许可证 |

## 请求行为

- 对本地回显服务实测全部 7 种方法、重复 Query、中文及特殊字符、可禁用参数/请求头、JSON/文本/表单、Basic/Bearer。
- 418 等非 2xx 状态保留响应正文；HEAD/204 的空正文可正常显示；多个 Set-Cookie 分开显示，不维护 Cookie jar。
- 实测 301/302/303/307/308 的方法和正文处理，以及禁用跟随、循环跳转上限、跨站移除 Authorization/Cookie/X-Api-Key、禁止携带正文跨站转发。
- 在临时目录生成 HTTPS 测试证书，仅测试进程通过 `NODE_EXTRA_CA_CERTS` 信任测试 CA；受信 HTTPS 请求成功、不受信证书失败、HTTPS → HTTP 跳转停留在 3xx。不修改系统信任配置。
- 超时、取消均检查目标服务的连接关闭；实际 Moss 的 action.cancel 也验证了相同行为。
- 对超过 1 MiB 的普通响应和 gzip 解压响应检查截断；不将截断的 UTF-8 尾部显示成乱码。
- 实测二进制 Base64、无效 UTF-8、ISO-8859-1、JSON 大整数和过深嵌套。
- HTML 响应仅在文本框中展示，不作为网页执行。

## UI 与存储

浏览器检查覆盖浅色、暗色和 1080/760/600/390/320 宽度，所有请求页签无水平溢出；外观事件生效，读取失败保留输入并降级；Backend 失败不会退回浏览器直接发送。

模板明确保存 URL 的协议/主机/路径和参数结构。测试核验了参数值、正文及凭据未进入持久存储；重新加载后可打开模板；删除需确认，写入失败保留输入且不虚构保存成功。

Moss 集成使用 Core checkout `c6fa4874cdd885c6735d714f3d741613e9d18262` 的真实 `EmbeddedAppView`、App preload、ZIP 安装器和 Runtime。App SDK 来源为本仓库固定的子模块 `7935e285c65cab7b20e5f1baab21f63a17aa7b54`（2.2.0）。

测试外壳将 App 私有 storage IPC 接到上述 Core 源码的原始 snapshot/key/value 函数，在临时目录写文件；未加载完整 Moss 主入口。该适配不替换请求实现。Electron webview 的文本输入、点击与刷新使用实际 WebContents API，以避免 CDP 对 webview 操作的差异。

已通过真实 `invokeToolContribution` 调用 `moss.http-client/request.send`，确认其 `write` 声明与请求结果。桌面实测平台为 macOS arm64；其它声明平台使用同一份纯 JavaScript 包，本次未分别执行桌面集成。

## 复现与产物

```bash
bun run validate
bun run check
bun run test
bun run build
cd apps/http-client
bun run test:browser
cd ../..
node scripts/package-app.mjs --app moss.http-client
cd apps/http-client
MOSS_CORE_ROOT=/path/to/moss bun run test:desktop
```

- `artifacts/moss.http-client/0.1.0/`：本地构建包。
- `artifacts/moss.http-client/screenshots/0.1.0/`：浏览器明暗主题与窄窗口截图。
- `artifacts/moss.http-client/verification/0.1.0/report.json`：真实 Moss 集成结果。
- `artifacts/moss.http-client/verification/0.1.0/http-light.png`、`http-dark.png`：Moss 容器截图。

`ci.yml` 和 `release-app.yml` 均运行 HTTP 的类型、Node、浏览器和独立 Backend 检查；正式包由 release 工作流签名并部署市场索引。正式签名 ZIP 的 SHA-256 和签名须根据发布产物核验，不复用本地无签名 ZIP 的校验值。
