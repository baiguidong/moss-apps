# 开发工具

Moss 的本地开发工具 App，提供时间戳、Base64、AES、JSON 与 HTTP 调试五个工作区。支持浅色、暗色与 Moss 运行时外观同步。转换在本机完成，HTTP 请求由本机 Node 服务发送。

## 使用

- **时间戳**：粘贴 10 位秒或 13 位毫秒时间戳并转换，其他长度手动选择单位；支持日期反向转换、毫秒、当前时间以及单项复制。日期格式为 `YYYY-MM-DD HH:mm:ss.SSS`，秒与毫秒部分可省略。支持本机时区、UTC 和常用固定偏移。本机夏令时重叠时间采用本地 Date 的较早匹配，固定偏移不会应用夏令时。
- **Base64**：文本按 UTF-8 编解码，支持中文、Emoji 和 URL-safe 形式。接受省略填充的有效输入，严格检查错误字符、填充位和 UTF-8。此版本用于文本，不支持任意二进制文件转换。
- **AES**：支持 GCM/CBC 和 128/192/256 位原始密钥；密钥支持 Hex、Base64、UTF-8，密文支持 Hex/Base64。加密默认每次生成新 IV，也可手动输入。GCM 使用 12 字节 IV、128 位标签，标签附在密文末尾；CBC 使用 16 字节 IV、PKCS#7 填充。解密后按 UTF-8 显示。不进行口令派生，不兼容 CryptoJS 默认的带盐口令封装格式。
- **JSON**：格式化、压缩、校验，支持 2/4 空格和 Tab 缩进；保留数字字面量、大整数、键顺序和重复键。接受标准 JSON，拒绝注释、末尾逗号和无效语法，报错包含行列位置。

上述转换输入不写入 App 存储、浏览器存储或日志，密钥只留在当前页面内存；关闭或刷新页面会清空。工具切换保留当前页面的输入，修改参数会清除旧结果。转换工具每次输入最多 128 KiB UTF-8 字节，结果最多 512 KiB，JSON 嵌套最多 128 层。较大的文件与流式处理不属于此版本。

## HTTP 调试

在左侧选择“HTTP 调试”（`#/http`），即可编辑请求、查看响应和管理模板。原独立应用 `moss.http-client` 已合并到 `moss.devtools`，不再单独构建或上架。模板保存在开发工具的 App 存储中，旧应用的模板不会自动迁移。

1. 填写完整的 `http://` 或 `https://` 地址，选择方法。
2. 按需填写参数、请求头、正文和鉴权，点击“发送请求”（请求编辑区内也可用 `⌘/Ctrl + Enter`）。
3. 查看状态码、耗时、响应正文和响应头。JSON 自动格式化，可切换原文和复制；数字原文保持不变。
4. 常用接口可“保存模板”。模板保存名称、方法、URL 的协议/主机/路径、参数名、请求头名、正文类型和请求选项；查询参数值、请求头值、正文、表单值及鉴权不保存。打开模板后重新填写这些值。

“填入示例”只填入公开 HTTPBin 回显接口；用户点击发送后才会连接。真实开发数据请使用自己的目标服务。

### 功能与边界

- GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS。
- 重复 Query 参数、可启停的参数/请求头；JSON、UTF-8 文本和 URL 编码表单。GET/HEAD 不发送正文。
- Basic / Bearer 鉴权或自定义 Authorization 请求头；两处填写时会提示冲突。
- 1–120 秒超时、取消。取消终止本机等待与连接，不能撤回服务器已经执行的操作。
- 自动重定向最多 10 次；跨站时仅保留 Accept/Accept-Language 等读取偏好，移除鉴权和自定义请求头。携带正文的跨站跳转和 HTTPS 降级停止在 3xx 响应，查看 Location 后可手动请求。
- 请求正文最大 1 MiB；响应按**解压后**大小截取前 1 MiB，并停止读取。显示大小为保留的响应正文大小，不是网络传输量；大响应不做完整下载。
- 文本按响应 charset 解码；二进制或无法解码的正文显示 Base64。HTML/XML 只展示文本，不执行脚本。
- 最多 50 个模板。App 不自动记录历史，也不保存请求/响应正文或鉴权；明确保存的模板名称和 URL 路径仍属于本地文件内容。
- 暂不包含文件上传、multipart、Cookie jar、环境变量、代理配置、WebSocket、cURL 导入或完整 API 集合导入。响应 Cookie 可查看，不会自动用于下一次请求。

请求由随 App 打包的 Node Backend 执行，可访问 localhost 和本机可达的内网；不使用浏览器 CORS 代理。保留 HTTPS 证书验证，不提供跳过验证开关。网络及系统信任配置受 Moss 使用的 Node 运行环境影响。

## Moss 接入

需要 Host API `^3.0.0`。按需启动的 Node Backend 提供五个页面操作：`timestamp.convert`、`base64.convert`、`aes.process`、`json.process`、`request.send`。这些操作仅由 App 界面调用，不向 Moss AI 助手注册工具。转换和请求操作不写文件，不申请平台权限；仅在用户保存请求模板时写入 App 存储。

Moss 中始终调用 Backend，连接失败会显示错误。普通浏览器中转换工具使用相同核心实现本地运行；HTTP 可编辑，但发送请求和保存模板需要 Moss。只有完整桌面验证才能确认宿主调用链。纯 JavaScript 包无原生依赖，市场声明 macOS、Windows、Linux 的 x64/arm64；桌面集成实测平台需见验证记录。

## 开发与验证

在仓库根目录执行：

```sh
bun install --frozen-lockfile
bun run --cwd apps/devtools dev
bun run --cwd apps/devtools check
bun run --cwd apps/devtools test
bun run --cwd apps/devtools test:browser
bun run --cwd apps/devtools build
bun run package -- --app moss.devtools --skip-build
MOSS_CORE_ROOT=/path/to/moss bun run --cwd apps/devtools test:desktop
```

HTTP 源测试使用 Node 测试运行器验证真实网络、TLS 和取消语义。浏览器测试使用本机 Google Chrome，CI 使用 Playwright Chromium，启动本地回显服务与真实编译后的合并 Backend。每次构建自动验证五个 action、HTTP 鉴权、取消和响应上限。桌面测试需要完整 Core checkout 及其 Electron/UI 依赖，安装 ZIP 到临时目录，使用真实 Core EmbeddedAppView、preload 和 App Runtime；不操作用户的 Moss 配置或已有 App。

ZIP 输出到 `artifacts/moss.devtools/0.2.0/`。浏览器截图和桌面验证报告位于 `artifacts/moss.devtools/`。推送 `moss.devtools-v0.2.0` 标签后，现有 Release App CI 校验、测试、构建、签名并更新应用市场。

开源来源见 [说明](assets/licenses/README.md)，安装包包含第三方许可证。完整检查范围见仓库中的 [验证记录](../../docs/devtools-app-verification.md)。
