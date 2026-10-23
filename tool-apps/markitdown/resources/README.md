# 文档转换

在会话中选择此 App，将本地 PDF、Word、PowerPoint、Excel 或网页转换为 Markdown。输出为工具返回的文本，保存文件可配合文件系统 App。

需要 Host API 3.11 和 Python >=3.10。首次连接下载固定版本 markitdown-mcp 0.0.1a7 及其依赖，后续复用。基础文件转换在本机完成；网页内容需要联网。

本地文件使用完整 file URI。服务遵循当前用户的文件权限，不限制在会话目录内。默认关闭第三方插件；扫描件 OCR 和高保真版式还原不属于首版能力。

上游：https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp 。MIT 许可证原文随包保留。
