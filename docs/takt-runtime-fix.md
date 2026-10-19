# TAKT 0.3.6 运行修复与紧凑标题栏

2026-10-14：已更新实际运行的 Moss Core，安装 **TAKT 0.3.6**，并在用户报错的原会话中重新运行同一工作流修订和任务，两个节点均已完成。

## 修复内容

- `App runtime generation is stale`：Core 在启动时核对实际进程的版本与代次，替换过期进程；旧队列请求不能覆盖新实例的注册信息。状态查询报告实际进程代次。
- `no valid structured output was returned`：TAKT 统一使用 Moss 的 `StructuredOutput` 工具返回结果，移除与工具参数结构冲突的直接 JSON 输出要求。Core 对格式错误最多追加两次结果修正，继续使用原节点上下文，仅提供输出工具，仍需通过 Schema 校验；取消和模型服务错误不会触发这种重试。
- 提交失败立即保存失败原因；App 重启后遗留的“提交中”记录标为中断。原失败记录和已完成结果保留，切换页面时清除上一页的错误提示。
- 状态、修订、节点进度、tokens、工具次数、时间并入标题工具栏，不再单独占一行。App 和会话 graph 同步调整；空间不足时自动换行。

## 实际验证结果

在 Moss 打开 **「验证 · 会话工作台 · 0.3.1」**，选择顶部「工作流」，可查看 **13:45 的已完成运行**。此前 13:33 的失败运行仍保留。

| 项目 | 结果 |
| --- | --- |
| 原会话 | `342ed91b-f9b1-494c-a026-a787f96bc1bf` |
| 工作流 | `flow_ed28800f-a908-4fc6-8bf4-7c006a41cc4d`，修订 2 |
| 原任务 | 本地笔记设计 mvp |
| 新运行 | `run_e603f6cd-aebd-4a81-9a82-3448d5481e66` |
| 结果 | ideas → summary → COMPLETE；2 次节点完成，4,893 tokens，2 次输出工具调用 |
| 最后一行 | **会话工作台验证通过。** |
| 未完成提交 | 5 条已标为中断，无节点执行，记录保留 |

![原会话完成结果与紧凑标题栏](../artifacts/moss.takt/0.3.6/verification/recovered-run-compact-header.png)

[窄窗口截图](../artifacts/moss.takt/0.3.6/verification/recovered-run-narrow.png) · [实际模型验证记录](../artifacts/moss.takt/0.3.6/verification/runtime-recovery-real-model.json) · [标题栏布局检查](../artifacts/moss.takt/0.3.6/verification/compact-layout.json)

## 检查与交付

- Core 实例生命周期、Host 能力、安全边界与结构化结果修正：**41 项测试通过**。
- App 引擎、存储、引用和提交失败恢复：**7 项测试通过**。
- 最终 ZIP 的 Runtime / Tasks / Execution 集成：**9 组检查通过**，包括幂等、取消、暂停、丢失事件对账与重启，使用受控模型结果。
- App TypeScript、冻结锁文件的隔离打包及 Backend handshake 通过；Core Node CLI 与 Electron runtime 构建通过。
- 原会话真实模型完整运行通过；正常与窄窗口无横向溢出，状态信息位于标题栏。

Core 全仓 TypeScript 检查仍有已有错误，包括缺少 `types/message.js`、`MACRO` 和第三方声明，不能记为全仓类型检查通过；本轮相关运行测试和实际桌面验证已通过。

[安装包](../artifacts/moss.takt/0.3.6/moss.takt-0.3.6.zip) · [安装及进程更替记录](../artifacts/moss.takt/0.3.6/verification/installation.json) · [Host 集成记录](../artifacts/moss.takt/0.3.6/verification/host-integration.json) · [最终状态](../artifacts/moss.takt/0.3.6/verification/final-state.json)

ZIP SHA-256：`ffdf3e4e4c31b0d977e8389ded64ad35913ec90b6ea4d9222334052c48a0c02d`。

当前保留用户选择的 **浅色 / TAKT 苔绿**。原工作流 App 仍启用，Moss 保持运行，未发布远端。原会话名称中的 0.3.1 是测试工作流名称，实际安装版本为 0.3.6。
