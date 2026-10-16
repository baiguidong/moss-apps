# 文档格式转换

0.1.2 新增 Linux AMD64 独立包。原生依赖随对应平台包交付；Linux 在 Ubuntu 24.04 验证。浏览器内 App 页面仍依赖 Moss Web Host 的独立适配。

`moss.document-converter@0.1.1`，Moss Desktop Host API >=3.14，首版平台 macOS Apple Silicon。使用 Pandoc 3.12.1，转换功能全部由上游提供。

在“更多 → 文档格式转换”选择本地文件，选择输入/输出格式。多个文件可逐个转换，也可按顺序合并。提供结构、样式、模板、引用、数学、电子书、幻灯片与其他参数表单；格式和参数目录从固定版本 CLI 实际输出生成。格式、默认模板和语法信息可在页面查询，无需输入文件。

结果保存在 App 数据目录，支持内容预览和另存导出，重名文件自动保留。DOCX、ODT、EPUB 等生成后由 Pandoc 回读为 HTML 内容预览；这不等于 Office 精确分页排版。PDF 默认使用随包的 Typst 0.15.1，可在 Moss 内预览；显式选择其他 PDF 引擎、Lua/filter 或模板时，相关自定义文件仍由用户提供。Markdown/HTML/电子书的远程素材是否联网取决于文档和所选参数。

会话选择此 App 后，Agent 使用随包 `moss-document-converter` skill 调用独立 CLI。输入 JSON 文件、实际 argv、运行日志、结果与页面共用；批处理部分失败返回 `partial` 并保留成功产物。引擎由 CI 下载校验并完整放入发布 ZIP，大文件在本机解压并校验，首次使用无需下载；不需要安装 Office 查看内容。

上游：[Pandoc 3.12.1](https://github.com/jgm/pandoc/releases/tag/3.12.1)，版权及许可见 `assets/licenses/COPYRIGHT`。Typst 的 Apache-2.0 许可与声明见 `assets/licenses/TYPST-LICENSE`、`TYPST-NOTICE`。Moss 自有适配代码独立于转换引擎。

## 开发与验证

在仓库根目录执行：

```sh
bun run --cwd apps/document-converter check
bun run --cwd apps/document-converter test
node scripts/package-app.mjs --app moss.document-converter
```

安装包包含可独立重建的源码与固定 SDK。真实引擎和 Moss 容器验证分别由 `scripts/verify-engine-clis.mjs`、`scripts/verify-engine-ui.mjs` 执行；运行依赖、Core 配套变更和测试范围见 [交付记录](../../docs/engine-apps-delivery.md)。
