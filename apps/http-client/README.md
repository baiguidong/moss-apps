# HTTP 调试

独立 Moss App `moss.http-client`。轻量请求编辑器，适合本地接口、内网服务与常用 REST API 调试。

## 使用

1. 填写完整的 `http://` 或 `https://` 地址，选择方法。
2. 按需填写参数、请求头、正文和鉴权，点击“发送请求”（请求编辑区内也可用 `⌘/Ctrl + Enter`）。
3. 查看状态码、耗时、响应正文和响应头。JSON 自动格式化，可切换原文和复制；数字原文保持不变。
4. 常用接口可“保存模板”。模板保存名称、方法、URL 的协议/主机/路径、参数名、请求头名、正文类型和请求选项；查询参数值、请求头值、正文、表单值及鉴权不保存。打开模板后重新填写这些值。

“填入示例”只填入公开 HTTPBin 回显接口；用户点击发送后才会连接。真实开发数据请使用自己的目标服务。

## 首版功能与边界

- GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS。
- 重复 Query 参数、可启停的参数/请求头；JSON、UTF-8 文本和 URL 编码表单。GET/HEAD 不发送正文。
- Basic / Bearer 鉴权或自定义 Authorization 请求头；两处填写时会提示冲突。
- 1–120 秒超时、取消。取消终止本机等待与连接，不能撤回服务器已经执行的操作。
- 自动重定向最多 10 次；跨站时仅保留 Accept/Accept-Language 等读取偏好，移除鉴权和自定义请求头。携带正文的跨站跳转和 HTTPS 降级停止在 3xx 响应，查看 Location 后可手动请求。
- 请求正文最大 1 MiB；响应按**解压后**大小截取前 1 MiB，并停止读取。显示大小为保留的响应正文大小，不是网络传输量；大响应不做完整下载。
- 文本按响应 charset 解码；二进制或无法解码的正文显示 Base64。HTML/XML 只展示文本，不执行脚本。
- 最多 50 个模板。App 不自动记录历史，也不保存请求/响应正文或鉴权；明确保存的模板名称和 URL 路径仍属于本地文件内容。
- 首版不包含文件上传、multipart、Cookie jar、环境变量、代理配置、WebSocket、cURL 导入或完整 API 集合导入。响应 Cookie 可查看，不会自动用于下一次请求。

请求由随 App 打包的 Node Backend 执行，可访问 localhost 和本机可达的内网；不使用浏览器 CORS 代理。保留 HTTPS 证书验证，不提供跳过验证开关。网络及系统信任配置受 Moss 使用的 Node 运行环境影响。

## Moss 接入

- 单个 `on-demand` Backend，`request.send` action 仅供 App 界面发送请求，不向 Moss AI 助手注册工具。
- 使用公开 `mossApp` action、取消、storage 与外观 API；无额外 Host 权限或协议。
- UI 遵循 Moss token，自动同步主题和背景。输入不会写入浏览器持久存储。
- 普通浏览器可编辑和查看示例输入；实际发送及模板持久化需要 Moss，不会以浏览器直连或虚构响应冒充 Backend 成功。

## 开发和验证

```bash
bun install
node scripts/validate-apps.mjs --app moss.http-client
cd apps/http-client
bun run check
bun run test
bun run test:browser
bun run build
```

源测试使用 Node 的测试运行器，以匹配正式 Backend 的网络、AbortSignal 和流语义。浏览器测试启动本地回显服务及真实编译后的 Backend；仅宿主 UI 桥接与存储采用测试适配器。

每次构建自动将 Backend 移入无依赖临时目录，在 Node 下检查实际 HTTP、鉴权、JSON、取消与大响应，确认无请求日志或数据文件。真实 Moss 桌面验证：

```bash
node scripts/package-app.mjs --app moss.http-client
cd apps/http-client
MOSS_CORE_ROOT=/path/to/moss bun run test:desktop
```

需完整 Core checkout 及其 UI/Electron 依赖；使用临时配置目录，不修改用户现有 Moss 安装。可用 `MOSS_HTTP_ARCHIVE=/absolute/package.zip` 核验指定安装包。

开源来源与许可证见 [说明](assets/licenses/README.md)。完整验证记录见 [文档](../../docs/http-client-app-verification.md)。
