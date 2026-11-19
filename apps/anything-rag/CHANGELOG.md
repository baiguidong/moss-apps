# Changelog

## 0.1.3

- 首次在 Moss 应用市场发布 RAG 知识库，支持本地文档导入、中文混合检索和原文引用。
- 通过「PDF 创作」识别扫描 PDF，保存可检索的文字及原页码。

## 0.1.2

- Index scanned PDFs through the installed PDF App's offline OCR and preserve page numbers in search results.

## 0.1.1

- Pass the selected PDF path to the Python compatibility parser during import and reindexing.
- Prepare the embedding engine automatically when the App opens.

## 0.1.0

- Added an independent Moss App for AnythingLLM-style Chinese RAG evaluation.
- Added private document storage, SQLite metadata, FTS5, hybrid retrieval, threshold refusal, revisions, jobs, resource URIs and a React workbench.
- Added TXT/Markdown/HTML/CSV/JSON/PDF/Office/code parsing and multilingual E5 embedding adapter.
