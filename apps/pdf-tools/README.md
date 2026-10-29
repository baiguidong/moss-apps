# PDF 创作

`moss.pdf@0.3.0` 是 Moss 内置的主会话 PDF App，默认全局常驻，需要 Host API >=3.21。打开 App 显示宿主通用详情与设置，没有独立工作台。源码位于 moss-apps，安装包由 Moss 构建时自动附带。

App ID 为 `moss.pdf`，与旧版 `moss.pdf-tools` 独立安装。
用户直接说“把这几份 PDF 合并”“识别扫描件”“填写表单”或“生成一份中文 PDF 并检查页面”。模型使用 `pdf_import` 导入文件、`pdf_list` 获取文件/字段、`pdf_create` 提交操作、`pdf_status` 查询结果、`pdf_export` 导出，无需选择 App 或填写参数代码。

支持中文文字 PDF 创作、合并/重排/旋转/删除页面、逐页拆分、文字提取、离线 OCR、交互表单填写及按要求展平、逐页 PNG 渲染。复杂图文 PDF 可先交给文档 App 创作，再导入本 App 核对。PDF 成果使用宿主文件预览；局部文字修改不冒充 HTML 元素标注能力。

pdf-lib、PDF.js、Canvas、Tesseract 和中英文识别模型随包交付，无需 Python、Ghostscript、Tesseract CLI 或云服务。支持 macOS Apple Silicon 和 Linux AMD64。OCR 输出带可搜索文字层的页面图像和 TXT/JSON，不能保留原 PDF 的矢量结构、签名或交互字段。原文件不改写。

每个输入 PDF 最多 250 MiB、500 页；普通页面操作最多 500 页，OCR 最多 80 页。加密文件明确拒绝。中文及混合识别仍需核对复杂版式、手写和数字。填写表单保留交互字段，只有明确要求才展平。

任务和文件持久保存在 App 数据目录；修改传 `parentId` 保留版本来源。结果提供资源链接、右侧展示参数及可导出的文件；后端空闲退出后仍可重新打开。

```sh
bun run --cwd apps/pdf-tools check
bun run --cwd apps/pdf-tools test
node scripts/package-app.mjs --app moss.pdf
```

测试覆盖真实 PDF 页面、中文创作和渲染、OCR 可搜索文字层、原生表单及版本引用。主会话与内置安装验证在 Moss Core 中运行 `cd ui && bun run test:creation-apps`。各依赖原始许可随包保留。
