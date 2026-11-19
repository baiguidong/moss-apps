# RAG 知识库

在 Moss 中导入和整理本地资料，使用中文语义与关键词检索，并查看答案引用的原文。检索架构参考 AnythingLLM。

## 当前能力

- 中文多语言 embedding adapter，模型不可用时提供可诊断的本地回退向量模式；
- 向量相似度 + SQLite FTS5/关键词分数混合检索；
- threshold、topK、可选 rerank、无证据拒答；
- 文档导入、版本、引用 URI、阅读器、索引任务和诊断面板；
- Moss App 原生 Actions、Tools 和 `moss-rag://` resource provider；
- 独立 React 工作台，沿用 `moss.knowledge-rag` 的主题和 appearance 机制。

## Embedding 说明

默认适配 `Xenova/multilingual-e5-small`，固定 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`。量化 ONNX 模型随安装包发布，首次准备时复制到 App 私有模型目录，
不依赖首次启动联网；索引时使用 `passage:` 前缀、查询时使用 `query:` 前缀。若安装包文件损坏或无法加载
Transformers.js 的 native 依赖，App 会在页面显式显示原因、模型缓存目录
和“重试 native”入口，同时仍可使用关键词和 FTS5 检索；这适合开发和功能验证，中文语义
效果评测必须确认设置页显示 `Native embedding` 后再进行。Node、sharp
和 ONNX Runtime 的平台原生文件随对应 Moss 安装包提供。

PDF 先使用 Node 解析器；遇到中文字体映射或非标准 PDF 无法提取文本时，会自动调用 Moss
管理的 Python 运行时和包内 `pypdf` 兼容解析器。纯扫描 PDF 通过已安装的「PDF 创作」进行离线 OCR，识别文字和页码随文档索引保存。安装知识库时授予调用 PDF 创作的权限。此版本要求 Moss Host API 3.23.1 或更高的兼容版本。普通 PDF、Office 文档和代码文件可以直接导入。

## 开发

```sh
bun install --ignore-scripts
bun run --cwd apps/anything-rag check
bun run --cwd apps/anything-rag test
bun run --cwd apps/anything-rag build
node scripts/validate-apps.mjs --app moss.anything-rag
node scripts/package-app.mjs --app moss.anything-rag
```

模型源文件随安装包的 Backend 一起发布，运行时缓存位于 App 私有数据目录。中文生产评测应使用真实多语言模型，并记录模型 revision、Recall@5、MRR、无答案误召回率和资源占用。
