# 开发工具验证记录

## 0.2.0：合并 HTTP 调试

验证日期：2026-10-10。应用说明见 [开发工具](../apps/devtools/README.md)。

- 类型检查与仓库 Manifest 校验通过；核心转换 14 项、HTTP/Host 集成 17 项测试通过。
- 18 项浏览器测试通过，覆盖五个工作区、HTTP 真实请求、模板保存、取消、工具切换保留输入，以及明暗主题与 320–1080px 布局。
- 构建与 ZIP 打包通过，隔离 Node 环境验证转换、HTTP 鉴权、响应上限、取消和无日志/文件写入。
- macOS arm64 桌面验证通过：真实 Moss 容器、preload、Runtime、ZIP 安装、五项工具、HTTP 模板存储与停用/恢复。
- 市场目录回归测试确认保留 `moss.devtools`，即使读取历史发布记录，也不再列出 `moss.http-client`。

安装包位于 `artifacts/moss.devtools/0.2.0/`；桌面报告与截图位于 `artifacts/moss.devtools/verification/0.2.0/`。本次未发布到远程市场。旧 HTTP 应用模板不会自动迁移。

## 0.1.0 历史记录

日期：2026-09-28。应用源码：[apps/devtools](../apps/devtools/README.md)。

## 已完成

| 检查 | 结果 |
| --- | --- |
| 仓库 Manifest 校验与所有 App 类型检查 | 通过 |
| 仓库测试 | 111 项通过，其中开发工具 14 项、97 个断言 |
| 开发工具浏览器测试 | 7 项通过 |
| 独立 Node 产物验证 | 通过；将打包后的 Backend 复制到临时目录，四项 action 和 NIST 向量均正确，不依赖源码目录的 node_modules |
| Moss Desktop 集成 | 7 组检查通过；在 macOS arm64 的真实 Core 容器中安装 ZIP 并调用真实 Backend |
| 第三方许可证 | 构建时收集并随 ZIP 保存，缺少许可证时构建失败 |

功能样本覆盖秒/毫秒、负时间戳、闰年、无效日期和固定时区；Base64 覆盖 Unicode、Emoji、BOM、URL-safe、填充位与无效 UTF-8；JSON 覆盖大整数、指数、负零、字符串转义、错误行列、标准语法和深度限制；AES 覆盖 NIST GCM 向量、CBC 与 Node crypto 的互操作、三种密钥长度、随机 IV、无效参数及认证标签篡改。

浏览器检查覆盖四个工作区、错误提示、旧结果清除、示例、随机密钥、加解密往返、Moss 主题变化，以及 1080 / 760 / 600 / 390 / 320 像素宽度。

## 真实 Moss 集成

使用本地 Core checkout `c6fa4874cdd885c6735d714f3d741613e9d18262` 中的 `EmbeddedAppView`、preload、ZIP 安装器与 App Runtime；SDK 来自本仓库固定的 `7935e285c65cab7b20e5f1baab21f63a17aa7b54` 子模块。

1. 把构建 ZIP 安装到独立临时目录，并验证按需启动 Backend。
2. 通过 UI → preload → Runtime → Node Backend 完成时间戳和 Base64 转换。
3. 在安装后的 JSON 工作区确认 `9007199254740993` 未丢失精度。
4. 在安装后的 AES 工作区生成密钥、加密并解密 Unicode 文本。
5. 使用真实 appearance 事件切换暗色与背景，检查嵌入布局和页脚边界。
6. 注册四个工具贡献，并通过 Runtime 的贡献调用链执行 JSON 操作。
7. 实际停用和启用 App，确认错误可见、旧结果清除、恢复后可继续操作。

Electron webview 的 CDP 文本与鼠标事件转发不稳定，测试使用 guest WebContents 的原生 `insertText` / `sendInputEvent` 输入，不通过修改 DOM 值或伪造转换结果通过检查。测试关闭后清理临时 Runtime 与 Electron 配置。

报告与截图保存在 `artifacts/moss.devtools/verification/0.1.0/`，浏览器截图位于 `artifacts/moss.devtools/screenshots/0.1.0/`。

## 持续验证和范围

CI 与本 App 的 Release 工作流均执行浏览器检查。构建脚本自动测试独立 Node Backend 后才允许进入打包。市场发布沿用现有签名、不可变 Release 和 Pages 索引流程。

macOS arm64 完成真实桌面验证；其他市场声明平台使用相同纯 JavaScript 包，尚未逐台完成桌面集成验证。此版本以小段文本转换为主，Base64 不处理任意二进制文件；AES 使用原始密钥，JSON 不接受 JSON5 扩展语法。AI 工具会受到 Moss 会话策略和结果大小限制。
