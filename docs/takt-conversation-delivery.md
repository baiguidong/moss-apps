# TAKT 会话工作台交付记录

最新版本为 **0.3.6**，修复实例代次与结构化输出问题，并合并运行信息到标题栏，见[运行修复与实测记录](takt-runtime-fix.md)。外观同步见[TAKT 苔绿交付记录](takt-appearance-delivery.md)。下文保留 0.3.3 阶段的功能与测试历史。

2026-10-14：已在使用现有 `~/.moss` 数据的开发版 Moss 中安装并启用 **moss.takt@0.3.3**。同时更新了 Moss 会话 UI 和嵌入视图返回原会话的处理。原 **moss.workflow@0.1.17-local.20261012081626** 保留并启用。

## 现在怎么用

1. 点击 TAKT App 的「新建工作流」或「从一句话开始」，在 Moss 主输入框描述需求并发送。三个新建入口都准备自然语言草稿，不打开 YAML 编辑器，也不自动发送。
2. 生成后点击会话顶部「工作流」，在正文中查看 graph。底部仍是同一个主会话输入框；发送消息后回到聊天。
3. 对话修改会保存新修订，顶部工作台可以切换各修订预览。明确要求运行后才启动，运行记录绑定当前主会话。
4. 点击节点查看结果和执行轮次。「在会话中讨论此节点」带入具体工作流、修订、run、node、occurrence 引用，只准备草稿。循环节点可以分别讨论第一轮或第二轮。
5. 图内支持暂停、继续、停止、补充要求和完整事件。独立 App 保留工作流库、历史、导入/导出及修订管理；已有工作流的「编辑」按钮打开 YAML 编辑器。

图与聊天切换保留 guest、缩放和节点选择；进度更新不自动切换视图。会话内的权限请求和用户问题仍显示在输入框上方。顶部工作台和 Agent Team 互斥打开。

## 留下的实际测试

在 Moss 普通会话中打开 **「TAKT 验证 · 会话工作台 · 0.3.1」**，点击顶部「工作流」。保留的 r1/r2 定义预览和已完成运行来自真实模型，0.3.3 可以继续查看。

| 标识 | 值 |
| --- | --- |
| 会话 | `108f55c3-8ee5-467d-a624-e2e727db45a9` |
| 工作流 | `flow_ed28800f-a908-4fc6-8bf4-7c006a41cc4d` |
| 运行 | `run_d98125fa-852c-42b1-8a47-24d17df87d32` |
| 修订 | 2；r1 仍保留 |
| 执行 | ideas → summary → COMPLETE；2 次节点完成，Host 记录 5,089 tokens |
| 最后一行 | **会话工作台验证通过。** |

「TAKT 验证 · 对话修改、运行与查询」追加保留了真实节点讨论：从图选择 summarize:1 后，在原会话发送问题，模型读取实际输出回答，没有新建运行。原「验证 · 条件返工两轮」仍可逐轮查看。

![会话内的工作流和节点结果](../artifacts/moss.takt/0.3.3/verification/final-conversation-node.png)

## 验证与交付物

| 检查 | 证据 |
| --- | --- |
| 自然语言新建、图与聊天切换、节点讨论、实际生成和修改、两份修订预览、原会话运行、图内暂停/继续、完成结果、会话隔离 | [真实模型记录（0.3.1）](../artifacts/moss.takt/0.3.1/verification/conversation-real-model.json)；8 组检查通过 |
| 最终安装 | [真实 Desktop 安装记录（0.3.3）](../artifacts/moss.takt/0.3.3/verification/installation.json) |
| 最终页面回归 | [布局和历史轮次记录](../artifacts/moss.takt/0.3.3/verification/workbench-layout.json)；原生截图、最小窗口、YAML 编辑、两轮历史及第二轮引用 |
| App 构建 | 冻结锁文件的隔离源码构建；TypeScript、6 项引擎/存储/引用测试和 Backend handshake 通过 |
| 最终 ZIP Host 集成 | [9 项 Runtime / Tasks / Execution 检查](../artifacts/moss.takt/0.3.3/verification/host-integration.json)；包括取消级联、幂等、修订固定、丢失推送对账、暂停和重启。这里使用受控模型结果，与真实模型测试分开 |
| Moss Core | TypeScript 和 renderer 构建通过；工作台与任务测试 5 项、App composer 测试 2 项通过 |

最终版本在已实测的 0.3.1 上压缩节点详情间距，并更新随包验证脚本。两版 Backend 源码的 6 个文件逐字节一致；没有为页面调整重复执行模型任务。用户权限模式保持原设置。

- [最终安装包](../artifacts/moss.takt/0.3.3/moss.takt-0.3.3.zip)
- [打包元信息](../artifacts/moss.takt/0.3.3/moss.takt-0.3.3.release.json)
- [自然语言草稿截图](../artifacts/moss.takt/0.3.1/verification/natural-language-create.png)
- [修订预览截图](../artifacts/moss.takt/0.3.1/verification/definition-preview.png)
- [暂停状态截图](../artifacts/moss.takt/0.3.1/verification/run-paused.png)
- [App 源码与使用说明](../apps/takt/README.md)
- [Moss 会话工作台约定](../../moss/ui/docs/app-conversation-workbench.md)

ZIP SHA-256：`77ab58deeae618e859f3c721ce90e731a91ea33edc9592a8cb48b6e0a2ce70dc`。

仅本地交付，未发布远端。顶部入口需要这次配套 Moss 更新；不需要新增模型配置、独立平台或全局 TAKT/Claude/Codex CLI。执行边界沿用[之前的交付记录](takt-app-delivery.md)：暂不支持拖线编辑、子工作流、定时触发、跨进程断点恢复和逐 token 展示。当前真实测试环境为 macOS；这次没有切换权限模式来模拟用户拒绝工具授权。
