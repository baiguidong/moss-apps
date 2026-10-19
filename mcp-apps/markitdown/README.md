# 文档转换 · MarkItDown

配置型 App `moss.markitdown@0.1.1`。固定使用微软 [`markitdown-mcp==0.0.1a7`](https://pypi.org/project/markitdown-mcp/0.0.1a7/)，由 Moss Core 提供设置页、Python 环境、MCP 连接和生命周期，不包含独立 Backend。

需要 Host API >=3.11 和 Python >=3.10。首次检查或调用时，Core 在独立虚拟环境下载上游依赖，后续复用缓存；不向系统 Python 安装包。固定的是顶层 MCP 包，传递依赖由上游版本约束解析。首次依赖准备需要联网。上游当前版本为预发布版。

本轮 Core 已将 Python 包安装等待时间延长至 240 秒、服务检查等待时间延长至 300 秒，以覆盖首次依赖准备；配套修改见 [交付记录](../../docs/office-mcp-app-delivery.md)。旧 Core 的较短等待时间可能中断首次下载，需更新 Core。

## 使用

在设置 → 工具中检查服务，然后在会话中选择“文档转换”。唯一工具为 `convert_to_markdown(uri)`，支持 `file:`、`http:`、`https:`、`data:` URI。例如让 AI 将 `需求说明.docx` 转为 Markdown，或提取 PDF、PPTX、XLSX 中的文字与表格。

本地文件必须转为绝对 file URI，并正确编码空格、中文及 `#` 等字符。工具返回 Markdown 内容，不直接写入输出文件；需要保存时可配合文件系统 App。基础 Office/PDF 文本提取在本机进行，网页读取需要联网。扫描件 OCR、复杂版式还原、公式计算及音视频转写不作为本 App 的验收能力。

上游没有目录白名单参数，也不使用 MCP roots 作为文件访问边界。本 App 不声明虚假的会话目录限制：服务按当前用户权限读取指定文件或网络资源。默认关闭第三方 MarkItDown 插件。不启用额外的 HTTP 监听或云端解析服务。

工具默认仅用于选中此 App 的会话；进程可空闲回收，后续调用自动重连。多会话不共享进程，原文件不会因转换被修改。

## 构建与验证

```sh
node scripts/package-app.mjs --app moss.markitdown
node scripts/verify-source-package.mjs --app moss.markitdown --rebuild
node scripts/verify-office-mcp.mjs --app moss.markitdown
```

包位于 `artifacts/moss.markitdown/0.1.1/`，携带配置源码、资源、固定 Core 生成器和构建锁文件。MCP 服务及其运行依赖在首次连接时下载，不在 ZIP 中预装。真实服务验证使用临时文件和独立配置，不读取用户文档；发布任务在 macOS、Windows 和 Linux 检查实际 MCP 调用。

上游：[Microsoft MarkItDown MCP](https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp)。许可证原文位于 `resources/assets/licenses/markitdown-mcp-LICENSE.txt`。
