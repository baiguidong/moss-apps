# TAKT 与 Moss 外观同步交付记录

后续已安装 **0.3.6**，修复实例代次与结构化输出问题，并合并运行信息到标题栏，见[运行修复与实测记录](takt-runtime-fix.md)。下文保留 0.3.5 的外观交付历史。

2026-10-14：Moss Core 新增「TAKT 苔绿」背景预设；实际运行的开发版 Moss 已安装并启用 **moss.takt@0.3.5**。使用原 `~/.moss` 用户数据，原工作流 App 和历史测试记录保留。

## 使用

进入 **设置 → 通用 → 外观 → 背景样式 → TAKT 苔绿**，即可在 Moss 主界面使用 TAKT 0.3.3 的柔和绿色、白色面板和细点纹理。浅色、暗色、跟随系统均可搭配使用。背景按钮按名称宽度分配空间，窗口变窄时换行。

TAKT 独立 App 和主会话顶部的「工作流」图视图实时跟随同一设置。默认、网格、圆点、渐变使用 Moss 标准配色；选择 TAKT 苔绿则恢复原 TAKT 风格。页面、画布、节点、连线和详情面板一同切换，无需刷新。

切换风格保留当前运行、选中节点与图的缩放位置。外观通过已有 App SDK 的 `getInfo().appearance` 和 `appearance` 事件同步；系统主题变化和页面重新聚焦也会同步。没有增加平台、模型配置或运行依赖。

## 实测

在实际 Electron Moss 中验证，使用已完成的运行读取历史结果，本轮没有重新执行模型任务。

| 检查 | 结果与记录 |
| --- | --- |
| 设置页实际点击、选中反馈、名称完整显示、设置保存 | 通过 |
| 5 种背景 × 浅色/暗色 | 10 组通过；比较 Core、独立 App、会话嵌入图的浏览器实际背景、文字及主色 |
| 图状态 | 切换时保留节点选择、缩放及同一嵌入页面 |
| App 重新载入、跟随系统 | 读取已保存预设；系统明暗变化更新图 |
| 页面错误 | 未出现未捕获异常 |
| App 最终源码包 | 冻结锁文件的隔离构建、TypeScript、6 项引擎/存储/引用测试、Backend handshake 通过 |
| Moss Core | TypeScript、renderer 构建、6 项外观设置测试与 8 项设置服务测试通过 |

[完整桌面验证记录](../artifacts/moss.takt/0.3.5/verification/appearance-real-desktop.json) · [安装记录](../artifacts/moss.takt/0.3.5/verification/installation.json) · [最终运行状态](../artifacts/moss.takt/0.3.5/verification/final-state.json)

测试结束已恢复用户原有的 **浅色 / 默认背景**，其余聊天外观设置也已核对恢复。Moss 保持运行；原 **moss.workflow@0.1.17-local.20261012081626** 仍启用。

在普通会话中打开 **「TAKT 验证 · 会话工作台 · 0.3.1」**，点击顶部「工作流」，仍可查看之前真实生成的修订和已完成运行。会话名称中的 0.3.1 表示测试创建时的版本，当前 App 为 0.3.5。

## 实际截图

![设置页新增 TAKT 苔绿](../artifacts/moss.takt/0.3.5/verification/settings-takt-light.png)

![主会话背景](../artifacts/moss.takt/0.3.5/verification/chat-takt-light.png)

![会话内工作流：浅色](../artifacts/moss.takt/0.3.5/verification/takt-theme-light.png)

![会话内工作流：暗色](../artifacts/moss.takt/0.3.5/verification/takt-theme-dark.png)

[暗色设置页](../artifacts/moss.takt/0.3.5/verification/settings-takt-dark.png) · [暗色聊天页](../artifacts/moss.takt/0.3.5/verification/chat-takt-dark.png) · [网格预设](../artifacts/moss.takt/0.3.5/verification/grid-theme-light.png)

## 交付物

- [TAKT 0.3.5 安装包（包含对应源码）](../artifacts/moss.takt/0.3.5/moss.takt-0.3.5.zip)
- [打包元信息](../artifacts/moss.takt/0.3.5/moss.takt-0.3.5.release.json)
- [App 使用说明与源码](../apps/takt/README.md)
- [可复跑的真实桌面验证脚本](../apps/takt/scripts/verify-appearance.mjs)
- [此前会话工作台交付记录](takt-conversation-delivery.md)

ZIP SHA-256：`e29869a2092ab76b6beaeef659d2bf7b8f00def8cda1f26c17c220b28adaaf7d`。

新增 Core 预设需要本次配套 Moss 更新；当前开发版已加载。当前为 macOS 本地交付，未发布远端。
