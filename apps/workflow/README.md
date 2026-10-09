# Workflow App

普通会话负责描述需求、创建和修改流程、自然语言输入与结果追问。App 负责目录、定义保存、调度、流程预览和运行记录。

- 在 App 点击“在会话中创建”，进入尚未发送的普通会话草稿。
- 已发布流程点击“使用工作流”；草稿点击“继续完善”。输入、修改和试跑都由会话中的 Agent 处理。
- 在普通会话的“选择资源 → 工作流”或 `@` 中选择已发布流程，发送需求后执行。
- 会话左侧嵌入 App 的轻量流程页，支持停止、恢复、切换运行和节点详情。聊天保留最终结果。
- 不导入旧 Workflow 数据，不提供人工 JSON 编辑器、参数 JSON 输入或内置业务模板。

继续复用 Definition v3 状态机引擎。App 调度节点，Moss Core 提供普通会话、真实 Agent 执行、权限、取消、预算和通用任务账本。

仍为 6 个 AI 工具：`workflow_read`、`workflow_create`、`workflow_edit`、`workflow_manage`、`workflow_run`、`workflow_remove`。删除历史迁移与模板操作；资源列表和会话准备是 UI Actions，不新增 AI 工具。

重试同一次启动复用 `submissionKey`。发布版本选择必须固定；发送前重新校验，不能静默换版本。大结果通过 `resourceRef` 分块读取。节点/边状态快照与详细事件分开存储，`run.events` 支持从序号分页读取。

```sh
bun run check
bun run test
bun run build
node ../../scripts/package-app.mjs --app workflow
node scripts/verify-package.mjs
node scripts/review-package.mjs
node scripts/verify-experience-cdp.mjs
```

CDP 验证使用 Moss 的 9222 端口和 Main inspector 的 9223 端口。测试会记录精确的工作流、会话及运行 ID；验证后按清单清理测试数据。验证记录在 `artifacts/moss.workflow/verification/0.1.9/`。
