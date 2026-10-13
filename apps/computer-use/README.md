# 电脑操控 · Computer Use

在 Moss 中安装、启用本 App，在会话中选择“电脑操控”，并打开 App 设置完成系统能力检查。第一次操作目标应用时，Moss 会询问本次会话或持久授权。前台键鼠单独按本次运行授权，可随时使用 Moss 的停止控制按钮。

支持 Windows 10/11 x64 和 macOS 14+（Apple Silicon、Intel），固定 Cua 0.34.0。工具 ID 为 `computer_use`，模型名称为 `app__moss_computer_use__computer_use`。输入形如 `{"request":{"action":"list_apps"}}`。完整动作定义见 `schemas/computer-use.json`，操作指引见 `assets/instructions.md`。

App 拥有 Cua 二进制、SDK、策略、窗口/快照适配、工具契约和设置页。Host API 3.3 提供可信原生入口、会话上下文、授权、全局控制占用、停止和生命周期。原生入口在 Electron 主进程加载，是可信执行域；它不具备普通 Backend 的进程隔离。主线程同步挂死或 native crash 无法由同线程定时器恢复。

本 App 要求受信任的发布者签名，并由 Host 允许该发布者运行原生适配器。普通未签名开发包可供检查源码，但不会暴露或执行原生工具。已加载的原生驱动更新后需重启 Moss；后续驱动更新无需重新发布 Moss（首次安装 0.2.0 需升级至 Host API 3.3）。卸载先停止控制，已加载版本文件在下次启动清理。

设置页通过 `app.getInfo().appearance` 和 `events.on('appearance')` 跟随 Moss 的深浅色及默认、网格、圆点、渐变背景。只有 Moss 选择“跟随系统”时才响应系统主题变化。

开发：仓库根执行 `bun install --frozen-lockfile`，本目录执行 `bun run check`、`bun run test`、`bun run build`。修改 schema 或 prompt 后先执行 `bun run generate`。构建按包内 manifest.platforms 选择目标平台（开发构建默认本机），下载固定版本并校验 SHA-256；安装包包含完整原生依赖，运行时不访问 npm 或 GitHub。第三方许可证随二进制和依赖保留在 `dist/native/`。

生成含完整可重建源码的本地包：仓库根执行 `bun run package -- --app computer-use`。正式签名使用仓库已有的发布流程；本地测试使用隔离的临时密钥，不写入用户信任配置。

可安装并运行原生驱动的包必须使用现有发布密钥：在已提交的干净 App 仓库和已固定的干净 Core 子模块中，设置 `MOSS_APP_SIGNING_PRIVATE_KEY_FILE` 后执行 `bun run package -- --app computer-use --require-signature`。签名不会自动发布。遇到 `Native adapters require a trusted signature from a Host-approved native publisher` 时，应更换为受信任的签名包；反复申请 macOS 权限不会解决包签名问题。

页面验证：先运行 `bun x vite build`，再用 Electron 执行 `scripts/verify-ui.electron.mjs`。该验证使用模拟 Host，覆盖主题事件、系统模式、四种背景、窄屏、开关操作、签名错误与恢复，不操作桌面目标应用。

Windows 使用 UI Automation 与 D3D 屏幕捕获，不显示 macOS 权限按钮。普通用户模式支持同等权限的应用；管理员应用可能拒绝控制，UAC 安全桌面不支持，App 不会自动提权。运行应用按实际可执行路径授权，并核对进程创建时间，防止同名程序或 PID 复用导致误控制。`bundleId` 保留兼容字段名，在 Windows 上是 App 生成的不透明标识；模型不能传任意路径或 PID。安装的 UWP 启动入口与实际运行程序分别授权；启动后重新列出应用。含参数的桌面快捷方式暂不直接启动，但已运行的应用仍可控制。

每个平台独立打包和签名：`bun run package -- --app computer-use --platform win32-x64 --require-signature`，Mac 将目标替换成 `darwin-arm64` 或 `darwin-x64`。文件名带平台后缀，互不覆盖；包内源码记录目标平台，可用 `node scripts/verify-source-package.mjs --app computer-use --platform win32-x64 --rebuild --require-signature` 重建核验。CI 在三个平台构建，并在 Windows Electron 中校验原生加载、截图和中文输入；所有任务通过后统一发布。市场按 Host 的 OS/CPU 选择包，手动装错平台也会被拒绝。Windows ARM64 原生包暂未发布。

本版本要求 Moss Host API >=3.4.0，展示入口为设置 → 工具 → 电脑操控。位置由 Manifest 声明；旧安装需要更新后生效。
