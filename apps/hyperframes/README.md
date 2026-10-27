# HyperFrames 动画工坊

Moss 本地视频 App，基于 [HeyGen 开源的 HyperFrames](https://github.com/heygen-com/hyperframes) 0.8.200（Apache-2.0）。HyperFrames 负责将 HTML/CSS 动画通过 Chromium 和 FFmpeg 渲染为 MP4；此仓库提供 Moss 的创作界面、项目存储、分镜工具和主会话入口，并非上游 Studio 的原样移植。

## 使用

1. 输入视频需求，或点击输入框下方的悬浮示例，快速填入产品介绍、数据报告、知识讲解或项目汇报需求。
2. 选择画幅与时长，点击「开始创作」。Moss 会打开主会话草稿，并选择 HyperFrames App、附带需求和当前项目；发送后开始 AI 创作。
3. 在主会话点击 HyperFrames 工作台入口回到 App 查看结果。项目引用携带返回路由；工作台中的「返回聊天」由 Moss 提供。已有项目的修改通过事件同步，输入中的需求不会被同步覆盖。
4. 选择分镜检查布局，必要时编辑文案和时长；HTML / CSS 编辑位于分镜的高级设置。
5. 点击「渲染视频」，选择质量和帧率，开始生成 MP4。完成后播放或导出，也可回看历史成片。失败详情可以展开，支持重试和取消。

「创建示例项目」直接创建可渲染的离线示例。首页视觉卡片属于创意示意，真实成片只出现在渲染结果中。场景预览不执行脚本；动画以成片为准。字幕文案不会自动转成语音。

场景内 CSS 动画使用从该镜头 0 秒开始的时间，`animation-delay` 不包含前序镜头时长。保存和校验返回的 `warnings` 会提示超出镜头时长的字面值延迟；CSS 动态值、层叠及最终可见性仍需逐镜头检查。安装包落盘后须由运行中的 Moss 激活新版；在外部进程安装时需要完整重启 Moss，单独重启 App 后端仍会使用宿主记住的旧版。

## 本地运行与验证

要求 Node.js 22、Bun 1.3.10 和本地 Chromium / Chrome。首次构建需获取固定版本的依赖与引擎资源，运行时关闭引擎自动安装和遥测。

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run test:render
```

构建会复制 HyperFrames 的完整生产依赖（包含 `hono`、平台可选依赖以及不同版本的嵌套依赖），保留许可证，并在仓库外的临时目录验证 CLI 和渲染命令加载。FFmpeg/ffprobe 随包校验并由运行时明确传给引擎。`test:render` 在隔离目录执行最终打包的 CLI，真正生成 15 秒三镜头 MP4，逐帧检查画面切换与场景动画的起止时间。

UI 验证：先用 `MOSS_HYPERFRAMES_OUTPUT=/tmp/hyperframes-redesign bun run test:render` 生成播放样本，再执行 `MOSS_HYPERFRAMES_OUTPUT=/tmp/hyperframes-redesign bun run test:ui`。测试使用真实项目后端与模拟的宿主会话/任务桥，覆盖示例填入、主会话上下文、返回路由、持久化、更新同步、取消/重试、视频播放/导出、项目切换、窄屏与深色。可通过 `MOSS_PLAYWRIGHT_MODULE` 指定 Playwright 模块文件、`CHROME_PATH` 指定浏览器。截图写入同一输出目录。宿主主会话的实际导航使用 SDK 的 `composer.prepare` 与 `moss-conversation` 视图协议。

项目、素材和渲染产物保存在 App 私有数据目录；升级保留已有项目和成片。
