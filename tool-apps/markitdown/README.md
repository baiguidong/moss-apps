# 文档转换 · MarkItDown

配置型 App `moss.markitdown@0.1.3`。固定使用微软 [`markitdown-mcp==0.0.1a7`](https://pypi.org/project/markitdown-mcp/0.0.1a7/)，由 Moss Core 提供设置页、Python 环境、MCP 连接和生命周期，不包含独立 Backend。

需要 Moss 内置 Python 3.13。构建时下载服务与第三方依赖，随平台 App 安装包放入 `runtime/site-packages/`。运行时使用 Core Python 和包内依赖，不创建 venv、不调用 pip、不联网安装。安装包不包含 Python 解释器。上游服务是固定的预发布版本。

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

包位于 `artifacts/moss.markitdown/0.1.3/`，按 macOS Apple Silicon、Windows x64 和 Linux x64 分别构建。构建机需要 Python 3.13，可通过 `MOSS_BUILD_PYTHON` 指定。实际依赖版本记录在包内 `runtime/python-bundle.json`。首次连接也直接使用包内依赖。

上游：[Microsoft MarkItDown MCP](https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp)。许可证原文位于 `resources/assets/licenses/markitdown-mcp-LICENSE.txt`。
