# 文档创作

`moss.document@0.3.0` 是 Moss 内置的主会话创作 App，默认全局常驻，需要 Host API >=3.21。源码保留在 moss-apps，Moss 打包时自动带上。打开 App 显示统一的基本信息、设置、技能、工具和资源详情，没有独立工作台。

App ID 为 `moss.document`，与旧版 `moss.document-converter` 独立安装。
在主会话直接说“写一份项目周报，生成可编辑 Word 并展示”。模型通过 `document_create` 创作、转换或审阅文档，`document_status` 查询结果，`document_read` 读取文本产物，`document_export` 导出。技能提供参数说明，用户无需填写 JSON 或选择 App。

创作支持 Markdown 生成 DOCX、PDF、HTML、Markdown 和 EPUB；已有文档支持 Pandoc 格式转换、批量转换、模板、引用及高级参数。DOCX 审阅支持原生修订和批注：修订定位必须唯一且处于同一文字片段；批注定位到唯一段落。不把普通重写当作保真的格式编辑。

成果由主会话资源引用及右侧展示。DOCX/EPUB 等由 Pandoc 回读为 HTML 内容预览，可以使用宿主标注；内容预览不是 Office 精确分页排版。PDF 使用宿主原生预览，默认由随包 Typst 和中文字体生成。修改传 `parentId` 创建新版本，保留原稿和原文件，导出同名文件自动改名。

Pandoc 3.12.1、Typst 0.15.1 随平台包交付，支持 macOS Apple Silicon 和 Linux AMD64。无需用户安装 Codex、Pandoc、Typst 或 Office；显式指定其他引擎、过滤器、模板时仍需提供相关文件。网络素材按转换参数处理。

```sh
bun run --cwd apps/document-converter check
bun run --cwd apps/document-converter test
node scripts/package-app.mjs --app moss.document
```

安装包包含可独立重建的源码和固定依赖。主会话、资源、模板跨 App 流程及通用详情验证在相邻 Moss Core 中运行 `cd ui && bun run test:creation-apps`。上游声明保留在 `assets/licenses`。
