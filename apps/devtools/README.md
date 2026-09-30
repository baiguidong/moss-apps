# 开发工具

Moss 的本地开发工具 App，提供时间戳、Base64、AES 与 JSON 四个工作区。支持浅色、暗色与 Moss 运行时外观同步；所有转换在本机完成，不需要账号或网络服务。

## 使用

- **时间戳**：粘贴 10 位秒或 13 位毫秒时间戳并转换，其他长度手动选择单位；支持日期反向转换、毫秒、当前时间以及单项复制。日期格式为 `YYYY-MM-DD HH:mm:ss.SSS`，秒与毫秒部分可省略。支持本机时区、UTC 和常用固定偏移。本机夏令时重叠时间采用本地 Date 的较早匹配，固定偏移不会应用夏令时。
- **Base64**：文本按 UTF-8 编解码，支持中文、Emoji 和 URL-safe 形式。接受省略填充的有效输入，严格检查错误字符、填充位和 UTF-8。此版本用于文本，不支持任意二进制文件转换。
- **AES**：支持 GCM/CBC 和 128/192/256 位原始密钥；密钥支持 Hex、Base64、UTF-8，密文支持 Hex/Base64。加密默认每次生成新 IV，也可手动输入。GCM 使用 12 字节 IV、128 位标签，标签附在密文末尾；CBC 使用 16 字节 IV、PKCS#7 填充。解密后按 UTF-8 显示。不进行口令派生，不兼容 CryptoJS 默认的带盐口令封装格式。
- **JSON**：格式化、压缩、校验，支持 2/4 空格和 Tab 缩进；保留数字字面量、大整数、键顺序和重复键。接受标准 JSON，拒绝注释、末尾逗号和无效语法，报错包含行列位置。

输入不写入 App 存储、浏览器存储或日志，密钥只留在当前页面内存；关闭或刷新页面会清空。工具切换保留当前页面的输入，修改参数会清除旧结果。每次输入最多 128 KiB UTF-8 字节，结果最多 512 KiB，JSON 嵌套最多 128 层。较大的文件与流式处理不属于此版本。

## Moss 接入

需要 Host API `^2.2.0`。按需启动的 Node Backend 提供四个页面操作：`timestamp.convert`、`base64.convert`、`aes.process`、`json.process`。这些操作仅由 App 界面调用，不向 Moss AI 助手注册工具。操作只返回转换结果，不写文件，不申请平台权限，App 自身不记录输入。

Moss 中始终调用 Backend，连接失败会显示错误。普通浏览器中使用相同核心实现本地运行，不使用伪造结果；只有完整桌面验证才能确认宿主调用链。纯 JavaScript 包无原生依赖，市场声明 macOS、Windows、Linux 的 x64/arm64；桌面集成实测平台需见验证记录。

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

浏览器测试使用本机 Google Chrome，CI 使用 Playwright Chromium。桌面测试需要完整 Core checkout 及其 Electron/UI 依赖，安装 ZIP 到临时目录，使用真实 Core EmbeddedAppView、preload 和 App Runtime；不操作用户的 Moss 配置或已有 App。

ZIP 输出到 `artifacts/moss.devtools/0.1.1/`。浏览器截图和桌面验证报告位于 `artifacts/moss.devtools/`。推送 `moss.devtools-v0.1.1` 标签后，现有 Release App CI 校验、测试、构建、签名并更新应用市场。

开源来源见 [说明](assets/licenses/README.md)，安装包包含第三方许可证。完整检查范围见仓库中的 [验证记录](../../docs/devtools-app-verification.md)。
