# 网盘

Moss 的个人云端文件空间。支持文件与目录列表、新建目录、文件删除、多文件上传和单文件下载。支持单文件只读分享、分享码和有效期。顶部通过“全部文件／上传／下载／已分享”切换，上传和下载分别保留进度、暂停、继续、取消和恢复记录。

## 使用

需要支持 Host API 3.0.0 的 Moss Desktop，以及已开启云端存储的 Moss Server。在 Moss 设置中连接服务器并登录，然后安装 `moss.drive-0.3.1.zip`。应用申请 `cloud-storage:read`、`cloud-storage:write`、`cloud-storage:delete` 和新增的 `cloud-storage:share`；安装或升级时需授予分享权限。Server 账号也需要分享权限，已有登录令牌可能需要重新登录。

- “全部文件”中点击文件夹进入，通过面包屑返回。切换标签和“更新列表”保留当前目录。
- “新建目录”创建到当前路径，支持根目录和子目录；空名称、非法字符、名称过长及同名冲突会提示修改。
- 文件行的删除按钮先显示文件名并确认；默认聚焦“取消”。确认后永久删除文件，更新列表和容量；失败时保留文件并显示原因。
- “上传文件”支持多选，上传到打开选择器时所在的目录。同名文件不会自动覆盖。
- 文件行的下载按钮打开系统保存对话框；取消对话框不会创建任务。
- 文件行的“分享”支持 1 天、7 天（默认）、30 天、自定义到期时间和永久有效。默认自动生成 6 位分享码，也可自定义 4–12 位字母数字或关闭分享码。创建后可复制链接或“链接＋分享码”。
- “已分享”按创建时间倒序分页，展示文件、创建时间、到期时间、分享码和状态。点击文件名查看链接，支持复制和确认取消分享；取消不删除原文件。已过期、已取消及文件失效记录保留。
- 接收者无需登录 Moss：无分享码链接在浏览器中直接下载，有分享码先验证。关闭 Moss 不影响已创建的分享；删除原文件或内容版本改变使分享失效。服务端检查期限和撤销状态。
- 新建上传／下载任务后进入对应标签查看进度。任务完成不会自动切换页面；切回“全部文件”可继续管理文件。切换标签和关闭页面不会停止传输；退出 Moss 后任务暂停，下次打开可继续。
- 页脚显示当前服务状态与容量。连接或账号变化时清除旧账号的页面数据。

当前不包含目录删除、文件夹分享、预览、移动、重命名、回收站、文件夹上传或自动同步。删除仅作用于确认的单个文件。

## 本地开发

在仓库根目录运行：

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
bun run --cwd apps/drive dev
```

浏览器中会明确显示演示模式。演示文件、上传与进度只存在于当前页面；演示下载使用浏览器保存。Moss 中始终通过真实 Host 服务操作，连接失败时不会切换到演示数据。

```sh
bun run --cwd apps/drive check
bun run --cwd apps/drive test
bun run --cwd apps/drive test:browser
bun run --cwd apps/drive build
bun run package -- --app moss.drive --skip-build
```

浏览器测试使用本机 Google Chrome；截图位于 `artifacts/moss.drive/screenshots/0.3.0/`。ZIP 输出到 `artifacts/moss.drive/0.3.0/`，本地包未附发布签名。

## 实现

React / TypeScript / Vite 页面与一个 persistent Node Backend。SDK 直接引用 Core 子模块 workspace 中的 `@moss/app-sdk`。Backend 只开放 Manifest 中声明的 16 个 action，通过 `moss.cloud-storage/v1` 完成请求和事件转发；文件内容、分片、校验与保存由 Moss Host 管理。

输入、输出和事件均按契约校验；业务错误使用 `{ ok: false, error: { code, message } }` 保留错误码。UI 按目录请求序号、账号代次及任务更新时间合并状态，不在 App KV 中保存账号文件元数据。文件和传输记录按游标分页，上传与下载分别按需展示历史记录。分享创建使用幂等键，失败重试不会重复创建；分享码与链接只由授权接口返回，不写入 App KV。目录、删除和分享操作绑定发起时的账号，切换账号后关闭弹窗并丢弃旧请求结果。

## 桌面集成验证

本地已有测试用 Moss Server 部署与完整 Core checkout 时，可运行：

```sh
MOSS_CORE_ROOT=/path/to/moss MOSS_DRIVE_TEST_DEPLOY=/path/to/test-deployment bun run --cwd apps/drive test:desktop
```

先构建并打包；脚本安装生成的 ZIP，使用 Core 的真实 EmbeddedAppView 容器、webview、preload、App Runtime 与 CloudStorageHost，在独立 Electron 窗口中验证嵌入布局和真实服务。测试以部署目录 `.env` 中的测试账号登录，使用部署 TLS 证书；只创建 UUID 命名的临时目录与测试文件，结束后清理。选择器返回固定的测试路径，不自动操作系统对话框，也不读取个人文件。默认使用 Core 安装的 macOS Electron；其他平台可通过 `MOSS_TEST_ELECTRON` 指定可执行文件。

已知 Core 限制：同名上传被拒绝后，其取消可能返回 `CANCEL_NOT_CONFIRMED`，页面显示原因并提供“重试取消”，不会虚报已取消。正常已初始化的上传取消已验证。Native 系统对话框的视觉交互、不同真实账号之间的切换、Windows 运行仍需对应环境验证。

分享方案见 [分享实施方案](../../docs/drive-sharing-plan.md)。Server 配置 `server.publicUrl` 可指定分享域名；未配置时使用当前连接地址，接收者必须能够访问该地址。旧 Server 的分享入口会提示升级，原有文件和传输操作仍可用。

详细范围见 [开发计划](../../docs/drive-app-plan.md)，验证方式与结果见 [验证记录](../../docs/drive-app-verification.md)。
