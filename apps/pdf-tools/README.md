# PDF 工作台

0.1.2 新增 Linux AMD64 独立包。原生依赖随对应平台包交付；Linux 在 Ubuntu 24.04 验证。浏览器内 App 页面仍依赖 Moss Web Host 的独立适配。

当前普通 Moss App `moss.pdf-tools@0.1.4`，包含 React UI、按需启动的 Node Backend、pdf-lib 1.17.1、PDF.js 5.4.624 和 Tesseract.js 6.0.1。需要 Moss Host API >=3.17，支持 macOS Apple Silicon 和 Linux AMD64。

在“更多 → PDF 工作台”导入 PDF，通过缩略图选择、旋转和排序页面，生成合并文档或逐页拆分。结果直接在 Moss 内翻页、缩放、搜索和导出，不依赖系统 PDF 阅读器。

OCR 使用随包的中英文 Tesseract 模型，不需要 Python、Ghostscript、Tesseract CLI 或云服务。这是调研中 OCRmyPDF 的替代实现：降低用户安装成本，同时保留本地可搜索 PDF 与文字导出的目标。OCR 将页面以 144 DPI 渲染，输出带文字层的页面图像及 TXT/JSON；不会保留原 PDF 的矢量结构、签名或交互表单，原文件保持不变。不要将此功能当作任意 PDF 的无损编辑器。

首版每个 PDF 最多 250 MiB、500 页；每次普通整理最多 500 页，OCR 最多 80 页；超大页面有像素上限。加密 PDF 明确拒绝。缩略图共用文档实例，按批次展开。识别语言可选简体中文、英文或混合，复杂版式和手写识别效果需自行检查。

AI 与 UI 共享持久任务和结果。选择 App 后可调用导入、任务创建与状态查询工具。运行依赖、WASM、PDF Worker、语言数据和原生 Canvas 随包提供；后台工作进程可取消，任务运行时由 Host 保活，空闲后端自动退出。结果由 Host 签名产物链接提供，后端退出后仍可预览；重启保留结果。

```sh
bun run --cwd apps/pdf-tools check
bun run --cwd apps/pdf-tools test
bun run --cwd apps/pdf-tools build
node scripts/package-app.mjs --app moss.pdf-tools
```

测试覆盖真实页面选择、顺序、旋转、拆分及 OCR 可搜索文字层。pdf-lib 为 MIT；PDF.js/Tesseract.js 为 Apache-2.0；Canvas 与模型按各包原始许可证分发。
