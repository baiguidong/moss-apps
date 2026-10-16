# 图片工具

0.1.2 新增 Linux AMD64 独立包。原生依赖随对应平台包交付；Linux 在 Ubuntu 24.04 验证。浏览器内 App 页面仍依赖 Moss Web Host 的独立适配。

普通 Moss App `moss.image-tools@0.1.1`，包含独立 React UI、Node Backend 和随包提供的 sharp 0.34.5。需要 Moss Host API >=3.11。首版声明并验证 macOS Apple Silicon。

在“更多 → 图片工具”导入本地图片，按功能分组配置，可以组合后批量处理：

- 格式与压缩：保留原格式，或输出 JPEG、PNG、WebP、AVIF、TIFF。
- 尺寸与填充：宽高、等比缩放/填满/留白/拉伸、对齐与智能关注位置、允许放大、透明或彩色扩边。
- 裁剪：鼠标绘制选区、拖动移动、8 个边角手柄、固定比例、键盘方向微调、数值坐标输入。裁剪基于自动纠正 EXIF 方向后的原图，在用户要求的旋转之前执行。
- 旋转与翻转：任意角度、常用角度、水平镜像、垂直翻转。
- 色彩调整：亮度、饱和度、色相、明度、伽马、黑白、反色、对比度拉伸、着色。
- 清晰度：模糊、锐化、中值降噪、二值化。
- 文字水印：文字、位置、字号、颜色、不透明度和边距。
- 图片信息：查看图像基本信息，移除或保留上游支持的 EXIF、ICC 等元数据。

所有像素处理由 sharp 0.34.5 / libvips 执行；适配代码负责参数校验、处理次序和预览。水印文本按 XML 转义后交由 sharp 渲染。处理后点击结果缩略图查看；保持画面结构时可滑动对比，裁剪/旋转等结果可返回原图查看。TIFF 输入和输出都提供内嵌 PNG 预览。

支持静态 JPEG、PNG、WebP、AVIF、TIFF；动画和多页图片明确拒绝，输入最多 6000 万像素，每批最多 50 张。PNG 和 TIFF LZW 使用无损压缩。默认不放大小图、移除原始元数据；JPEG 用所选颜色填充透明区域。此版不含 AI 抠图、生成式修图或图层编辑器。

Agent 与页面共用参数、文件和持久任务，提供 5 个真实入口：`files_import`、`workspace_get`、`tasks_start`、`tasks_cancel`、`files_export`。处理能力通过 `tasks_start.options` 组合，不以界面功能数冒充工具数量。退出 Moss 会中断工作，重新打开保留完成结果并可重试。

所有处理依赖随包提供，运行无需网络或系统安装 sharp。后端只在本机启动带随机访问令牌的只读预览服务；导入文件复制到 App 私有目录，结果按文件 ID 提供。用户使用文件夹选择器导出，无需外部查看软件。

```sh
bun run --cwd apps/image-tools check
bun run --cwd apps/image-tools test
bun run --cwd apps/image-tools build
node scripts/package-app.mjs --app moss.image-tools
```

测试覆盖真实图片转换、透明度、尺寸、错误裁剪、真实任务、预览 Range 请求、未授权来源、导出不覆盖与重启恢复。上游与许可证：[sharp](https://github.com/lovell/sharp)，Apache-2.0；各运行依赖原始许可随包保留。
