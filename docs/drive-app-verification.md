# 网盘 0.3.0 分享验证（2026-09-29）

## 正式发布与 Server 部署

- [发布 CI](https://github.com/baiguidong/moss-apps/actions/runs/36543186026) 与 [全仓库 CI](https://github.com/baiguidong/moss-apps/actions/runs/36543177898) 均通过；[0.3.0 Release](https://github.com/baiguidong/moss-apps/releases/tag/moss.drive-v0.3.0) 和应用市场目录已发布。
- 从 Release 重新下载 ZIP，逐文件校验及 `release-1` 公钥签名验证通过。正式包 185983 字节，SHA-256 为 `62aa8cd9ffa5dc179cad37561bce7cf9ecbd8b144d864d27fe8ec75a7a8d61d8`；市场最新版本与产物校验值一致。
- Core `ead01ae83318585e15cdb16185e0697561da02b5` 在独立目录构建 Linux AMD64 Server，部署版本 `0.0.1-share.20260929.ead01ae8`。更新前已备份数据库和配置；MySQL schema 从 4 升到 5，Nginx 增加 `/s/` 代理，服务健康检查通过。
- 部署后验证现有管理员登录、管理页、S3、1 MiB + 101 字节上传下载 SHA-256、分享创建幂等、分享码校验、安全 Cookie、匿名直链、HEAD/Range、过期、撤销与列表状态；测试对象、分享与配额占用已清理。
- MySQL、Silo 与 Nginx 容器保持运行。Server 重启后处理了失效数据库占用锁；原会话与记录保留，会话 runner 已自动恢复为 ready。Desktop 本次未发布，使用网盘 0.3.0 仍需要 Host API 2.3。

## 发布前验证

- Core Host API / SDK 升级到 2.3.0；新增分享创建、列表、撤销与独立分享权限。
- App 单元测试 27 项、浏览器测试 11 项通过，覆盖分享创建、复制用信息、列表、取消、账号隔离与超时幂等重试。320px 窄窗口和浅/深色文件页面无横向溢出。
- Core SQLite/MySQL 服务端回归各 67 项、Desktop 回归 882 项通过；Server/Desktop 类型检查、Server 构建与 Compose 部署校验通过。
- Chrome 通过真实 Server 的分享码页面下载文件；公开 HTTP 验证无登录下载、错误分享码、Range/HEAD、过期、撤销、文件删除/版本变化、所有者禁用、限流和下载中的撤销。
- 真实 Silo 测试验证分享下载、备份恢复及 2 GiB + 101 字节上传/下载 SHA-256。Host 对真实 Server 完成分享创建、查询、撤销与公开链接访问。
- 截图在 `artifacts/moss.drive/screenshots/0.3.0/`，包含 `shares.png`、`shares-narrow.png` 和 `public-share.png`。浏览器演示中的 `demo.invalid` 链接仅用于展示。

本节记录发布前的本地验证。0.3.0 需要包含本次分享能力的 Moss Desktop（Host API 2.3）与 Server，并授予 `cloud-storage:share`；外部接收者需要可访问的 `server.publicUrl` 或当前连接地址。完整 Desktop 嵌入窗口的分享流程未在本轮重跑，沿用组件/Host/HTTP 分层回归。Core 原有其他未提交修改保持保留。

---

# 网盘验证记录

## 0.2.0 目录、文件删除与独立标签（2026-09-24）

页面顶部采用“全部文件／上传／下载”三个标签；切换保留浏览路径，创建任务后进入对应标签，任务结束不自动切换。全部文件支持新建目录和单个文件删除，目录与删除弹窗遵循 Moss 外观，支持键盘操作。

- 全仓库 Manifest 和类型检查通过；91 项单元测试通过，其中网盘 23 项，覆盖目录绑定、重名与非法名称、重复提交、删除权限失败、旧列表不能恢复已删文件，以及账号切换后作废操作。
- 10 项浏览器测试通过；浅色、深色、581–760 px 分栏、390 px 文件列表与 320 px 新建目录弹窗检查通过。标签支持方向键与 Home/End，删除确认默认聚焦取消。
- 最终 ZIP 经独立 Electron、Core 的真实嵌入容器、preload、App Runtime 和 CloudStorageHost 验证：真实创建目录、进入目录、同名冲突、删除确认、服务器文件消失和容量释放均通过。
- 上传、下载、暂停、Host 重启后恢复、同名冲突、传输取消及断开连接清空数据回归通过。35 MiB + 101 字节下载与原文件 SHA-256 一致；渲染异常为 0。
- 文件、上传和下载三个页面的记录独立；切回文件页后保留测试目录。所有文件行与页脚完整可见，本次嵌入窗口中文件区为 530 / 680 px。
- SDK 继续直接引用 Core 子模块。新增 `folders.create`、`files.delete` 两个 Backend action 与 `cloud-storage:delete` 权限；删除权限未授予时显示原因并保留文件。

安装包：`artifacts/moss.drive/0.2.0/moss.drive-0.2.0.zip`。浏览器截图位于 `artifacts/moss.drive/screenshots/0.2.0/`，真实嵌入截图与报告位于 `artifacts/moss.drive/verification/0.2.0/`。测试使用独立 UUID 目录，创建的子目录、文件与上传会话均在结束后清理。

当前仅提供文件删除；目录删除、回收站和批量删除不在本版范围。原生选择器的视觉自动化、跨平台和下述 Core 同名冲突后的取消确认限制仍适用。下方保留旧版本验证记录。

## 0.1.1 界面优化（2026-09-24）

依据 Moss 嵌入页面截图调整整体布局：内部只保留一行目录路径与操作，移除重复标题与图标；文件行从 62 px 压缩到 48 px；完成记录从双行进度改为单行方向、名称、大小与结果。成功提示条及浮层已移除，避免挤占空间或挡住传输控制。

自动打开的传输面板在全部任务结束后延迟 1.8 秒收成页脚摘要；用户主动打开、点击或聚焦面板后保持展开。批量创建尚未结束、进度查询失败、操作报错、暂停或取消未确认时不会自动收起。

- 全仓库 Manifest、类型检查及 87 项单元测试通过，其中网盘 19 项。
- Chrome 7 项浏览器回归通过，涵盖完成后收起、方向保留、短窗口下 3 个文件与 3 条完成记录同时可见，以及浅色、深色、390 px 和 320 px 布局。
- 桌面验证通过：直接编译并挂载 Core 的 `EmbeddedAppView`、Button 和全局样式，App 运行于真实 Electron webview 中；安装最终 ZIP 后，经实际 preload、App Runtime、CloudStorageHost 访问测试服务器。
- 真实上传、暂停恢复、Host 重启后重新打开页面、下载 SHA-256 一致性、保存取消、同名冲突及传输取消均通过。渲染异常为 0。
- 嵌入布局、摘要展开与页脚可见性检查通过；本次窗口中，收起后的文件区占嵌入区高度约 83%（567 / 680 px）。截图使用 Electron 原生合成画面，避免浏览器截图临时调整 webview 尺寸。
- 当前安装包：`artifacts/moss.drive/0.1.1/moss.drive-0.1.1.zip`。
- 当前截图：`artifacts/moss.drive/screenshots/0.1.1/`；实际嵌入截图及报告：`artifacts/moss.drive/verification/0.1.1/`。

Core 的通用外层“刷新”仍是重新载入 App，网盘内部操作明确为“更新列表”，并保留当前目录与面板状态。本次优化只需升级网盘 App，无需修改或升级 Core。下述原生对话框手工操作、跨平台和 Core 取消确认限制仍适用。

## 0.1.0 初版记录

2026-09-24 完成 `moss.drive@0.1.0` 的文件列表、目录导航、多文件上传、单文件下载、传输管理与本地安装包。页面采用 Moss 原生颜色与布局规则，提供浅色、深色及窄窗口适配。

## 自动化检查

| 范围 | 结果 |
| --- | --- |
| 仓库 `validate`、各 App `check` | 通过 |
| 仓库与 App 单元测试 | 82 项通过，其中网盘 14 项 |
| 全仓库 `build` | 通过 |
| ZIP 打包与包校验 | 通过，可由 Core App Runtime 安装 |
| Google Chrome 浏览器交互 | 5 项通过 |
| 浅色、深色、390 px 和 320 px 窄窗口 | 操作可见，无水平溢出；截图已检查 |

网盘单元测试覆盖目录请求竞争、分页去重、全量任务分页恢复、事件与旧快照合并、同毫秒取消事件保护、选择器打开后切换目录、部分上传失败、账号变化后清空数据、原生保存取消、任务创建与完成分离、取消确认、页面销毁与后端 IPC 输入输出校验。

浏览器测试覆盖演示目录、多文件选择入口、上传、暂停、恢复、下载，以及模拟 Moss bridge 下的真实模式区分、账号失效、主题变化、服务不可用与后端停止。演示测试不代表云端传输成功。

## 真实服务与桌面链路

使用本机测试部署 `/Users/bgd/moss-server-local` 和 Core checkout `94356e4e`，在独立 Electron 进程中安装最终 ZIP。测试使用 Core 的 `app-preload.mjs`、`AppRuntimeHost`、协议校验与 `CloudStorageHost`；生产 UI、构建后的 Node Backend 和真实 Moss Server 全部参与。没有改动正在运行的 Moss 窗口、已安装应用或个人设置。

已验证：

- ZIP 安装及 persistent Backend 启动，页面显示真实运行状态。
- 创建独立测试目录，浏览根目录、进入目录及空目录展示。
- 上传 2 个文件；35 MiB + 101 字节文件暂停后保留任务，Host 重启及页面重开后显式恢复，最终云端列表出现完整文件。
- 保存对话框取消的返回契约，不创建下载任务、不显示虚假错误。
- 真实下载与原文件 SHA-256 一致：`26a2116b7a240f2f2ba8761fde0f164225fa5a1ed42d17366e78382c1e903201`。
- 已存在的下载目标保持原内容，页面说明另选保存名称，失败任务可取消。
- 同名上传不会覆盖文件，并显示冲突原因。
- 已初始化上传经过服务器取消确认，最终状态为“已取消”。
- 关闭远程连接立即清空文件、路径、容量及任务，不保留旧账号页面数据。
- 收到真实任务进度与状态事件，渲染过程中没有未捕获异常。

测试创建的 UUID 目录和文件在结束时清理。临时 Electron profile、App 安装目录、传输记录与下载文件也随测试环境一起移除。

原生文件选择和保存对话框使用固定测试路径返回值；**系统对话框的视觉操作、完整 Moss 主窗口中的手工安装、不同真实账号之间切换、Windows 与 Intel Mac 运行未做验收**。macOS 上的独立 Core 桌面链路通过，不等同于所有平台已验证。

## Core 已知限制

当上传初始化被服务器以同名冲突拒绝后，Host 的取消逻辑可能继续查询一个不存在的上传初始化记录，返回 `CANCEL_NOT_CONFIRMED`。页面保留“已暂停”和未确认原因，并提供“重试取消”，不把它标记为已取消。正常已初始化上传的取消已通过真实服务验证。本次没有修改 Core 的传输实现。

## 产物与复现

- 安装包：`artifacts/moss.drive/0.1.0/moss.drive-0.1.0.zip`，本地未签名，未发布。
- 页面截图：`artifacts/moss.drive/screenshots/{light,dark,light-narrow,dark-narrow}.png`。
- 桌面截图与报告：`artifacts/moss.drive/verification/desktop.png`、`desktop-report.json`。
- 复现命令见 [网盘 README](../apps/drive/README.md)。真实服务验证需显式提供测试部署路径，使用该部署的 TLS 证书与测试账号。

SDK workspace 使用 `vendor/moss-core` 中的 `@moss/app-sdk`，固定于 `7935e285`，没有复制第二份 SDK 源码。Core 测试涉及的 preload、runtime、cloud-storage 文件与已提交版本一致；完整 Core 工作区仍有其他任务的改动。
