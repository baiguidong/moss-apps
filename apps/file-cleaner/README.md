# 文件清理

0.1.2 新增 Linux AMD64 独立包。原生依赖随对应平台包交付；Linux 在 Ubuntu 24.04 验证。浏览器内 App 页面仍依赖 Moss Web Host 的独立适配。

`moss.file-cleaner@0.1.2`，Moss Desktop Host API >=3.14，平台为 macOS Apple Silicon 和 Linux AMD64。核心使用 Czkawka 12.0.2；Moss 只提供参数表单、进程管理、任务记录和结果展示。

在“更多 → 文件清理”选择目录，选择扫描类别并开始。覆盖上游 14 类功能：重复文件、空文件夹、大文件、空文件、临时文件、相似图片、重复音频、无效链接、损坏文件、相似视频、扩展名检查、文件名检查、视频优化、EXIF 清理。视频优化包含转码和裁剪黑边的独立参数。表单来自固定版本真实 `--help`，高级参数按独立 argv 元素传入。

扫描默认不修改原文件。删除、改名、修复和覆盖操作需要勾选允许修改，并按上游实际策略执行；不自建清理算法。结果显示匹配组和相似图片，匹配项总大小不等于可释放空间。大报告在页面分页截取，完整内容可导出 JSON/TXT。

选择会话中的此 App 后，Agent 获得随包 `moss-file-cleaner` skill，使用 Core 提供的 CLI 路径与数据目录。CLI 可以独立查看页面失败任务、修正参数重跑；全部记录会回到 UI。基础功能不依赖大模型。

安装包携带并校验 Czkawka、FFmpeg 8.0.1 和 ffprobe 5.0.1，首次使用无需联网下载依赖。无需启动或安装上游 GUI。特殊 HEIF/RAW 等格式取决于所选上游二进制的实际编解码支持。

上游：[Czkawka](https://github.com/qarmin/czkawka/releases/tag/12.0.2)。CLI 声明 MIT；媒体二进制的构建与许可证记录见 `assets/licenses/` 及 `resources/ffmpeg.json`、`resources/ffprobe.json`。

## 开发与验证

在仓库根目录执行：

```sh
bun run --cwd apps/file-cleaner check
bun run --cwd apps/file-cleaner test
node scripts/package-app.mjs --app moss.file-cleaner
```

安装包包含可独立重建的源码与固定 SDK。真实引擎和 Moss 容器验证分别由 `scripts/verify-engine-clis.mjs`、`scripts/verify-engine-ui.mjs` 执行；运行依赖、Core 配套变更和测试范围见 [交付记录](../../docs/engine-apps-delivery.md)。
