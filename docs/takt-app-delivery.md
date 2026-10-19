# TAKT 工作流 App 交付与测试记录

最新版本为 **0.3.6**，修复实例代次与结构化输出问题，并合并运行信息到标题栏，见[运行修复与实测记录](takt-runtime-fix.md)。外观同步见[TAKT 苔绿交付记录](takt-appearance-delivery.md)，会话顶部 graph 工作台和自然语言新建见[会话交付记录](takt-conversation-delivery.md)。下文保留 0.2.2 阶段的交付历史。

2026-10-14：已完成本次 Moss 集成，并在仓库开发版 Moss 中安装、启用 **`moss.takt@0.2.2`**。使用现有 `~/.moss` 用户数据。Moss 保持运行，TAKT 窗口停留在已完成的双路并行测试上。

原有 **`moss.workflow@0.1.17-local.20261012081626`** 仍已安装且启用。本次新增独立 App，没有替换原工作流。最终状态见 [运行态核对](../artifacts/moss.takt/0.2.2/verification/final-state.json)。

**直接查看**

在 Moss「更多 → TAKT 工作流」打开 App。进入「运行历史」，可查看以下真实模型测试；点击节点可看输出，循环节点可切换执行轮次。

| 保留的名称 | 可查看内容 |
| --- | --- |
| 验证 · 分析与双路审查 · 0.2.0 | 分析 → 双路并行审查 → 汇总；5 次逻辑节点完成，4 次 Agent 调用。暂停后补充的“TAKT 验证通过。”已出现在最终输出中。另有同名取消记录。 |
| 验证 · 条件返工两轮 | 第一轮“需要修改：请补充验证步骤”，第二轮“验收通过：已补充验证步骤”；两次执行、两次独立判断。 |
| 验证 · 对话生成 | 由 Moss 对话创建；随后在 0.2.2 中通过对话修改为 r2 并运行，输出包含“对话运行验证通过”。r1 仍保留。 |
| 验证 · 目录与修订 · 036610 | 页面导入后编辑为 r2，再将 r1 内容保存为 r3，可打开修订历史比较。 |
| 验证 · 分析与双路审查 · 0.1.1 | 首个成功通过真实模型验证的版本及运行记录。 |
| 验证 · 分析与双路审查 · 0.1.0 | 最初的真实失败记录，保留以便核对修复过程。 |

辅助测试副本已经归档，勾选「显示归档」仍可查看；没有删除测试流程、会话或运行。

Moss 主窗口另保留两条普通会话：

- **TAKT 验证 · 对话生成工作流**：`86ed983c-f6b9-4b4b-a65d-c871c4edfd4b`，实际调用 App 创建流程，未自动运行。
- **TAKT 验证 · 对话修改、运行与查询**：`843b7d26-d893-421d-afa7-47350456cc03`，实际修改、启动和查询结果；运行绑定同一个来源会话。

![已完成的双路并行工作流](../artifacts/moss.takt/0.2.2/verification/final-parallel.png)

![两轮返工的流程图与第二轮输出](../artifacts/moss.takt/0.2.2/verification/final-loop.png)

**当前能力**

| 操作 | 实现 |
| --- | --- |
| 对话创作 | 创建、校验、修改 YAML，保存不可变修订；从 App 准备 Moss 对话草稿和固定修订资源引用。 |
| 工作流运行 | 内联 Agent、条件转移、有限循环、静态并行；后台运行并复用 Moss 来源会话的模型、工具和权限。 |
| 观察与控制 | 执行图、实际节点状态、访问轮次、节点输出、Host token/工具调用计数、完整事件；取消、暂停后续派发、继续、补充要求、按原修订重跑。 |
| 目录管理 | 搜索和分页、修订历史、历史内容另存修订、复制、归档/恢复、YAML 导入/导出。 |
| 记录 | 本地定义、固定运行快照、JSONL 事件、完整结果资源；关闭页面再打开可以继续查看。 |

从 App 窗口启动时，由 Host 创建普通 Moss 会话，使用默认模型、权限和工作区。从对话启动时，绑定实际发起调用的来源会话。没有新增模型配置、独立平台服务或全局 TAKT/Claude/Codex CLI 依赖。

暂停会等已经派发的调用完成，再阻止后续派发；暂停时间仍计入任务总时长。补充要求提供给后续调用，已经开始的调用继续使用原指令。

**验证结果与证据**

| 验证 | 结果与证据 |
| --- | --- |
| 首版安装与真实失败 | 0.1.0 已通过实际 Desktop 安装入口安装；一条分支返回的最终文本不是合法独立 JSON，运行明确失败。保留 [原始记录](../artifacts/moss.takt/0.1.0/verification/desktop-real-model.json)。 |
| 首版修复 | 0.1.1 加强最终 JSON 输出协议，真实模型并行任务完成。[记录](../artifacts/moss.takt/0.1.1/verification/desktop-real-model.json)。 |
| 真实并行、暂停、补充、继续 | 0.2.0 暂停期间无新调用，继续后最终结果包含补充要求；5 个逻辑节点均有真实结果。[记录](../artifacts/moss.takt/0.2.0/verification/desktop-real-model.json)。 |
| 真实条件循环 | 确实执行两轮，并由 Moss 执行独立判断。[记录](../artifacts/moss.takt/0.2.0/verification/loop-real.json)。 |
| 真实取消 | 等第一条 Host execution 开始后点击停止，运行取消，未派发下游。[记录](../artifacts/moss.takt/0.2.0/verification/cancel-real.json)。 |
| 对话端到端 | 0.2.2 对话修改为新修订、实际启动、完成两步，再调用 App 查询真实结果；原修订不变，run 使用原来源会话。[记录](../artifacts/moss.takt/0.2.2/verification/conversation-roundtrip.json)。 |
| 当前安装包桌面回归 | 0.2.2 实际安装、导入/编辑/恢复修订、复制/归档/恢复、详情页新建、对话草稿、循环轮次、事件、主题、窄窗口、刷新及升级后历史均通过；无页面脚本错误。[记录](../artifacts/moss.takt/0.2.2/verification/desktop-regression.json)。 |
| 引擎与存储测试 | 隔离源码构建中 TypeScript 检查通过，5 项测试通过：严格定义校验、修订与 Unicode 大结果、实际 TAKT 并行引擎、条件循环、取消阻止下游。 |
| Host 集成 | 当前 0.2.2 ZIP 通过 9 项真实 Core Runtime / Tasks / Execution IPC 检查，覆盖幂等、固定修订、取消级联、丢失推送对账、重启、暂停和资源引用。这里使用受控模型返回值，与真实模型测试分开记录。[记录](../artifacts/moss.takt/0.2.2/verification/host-integration.json)。 |

0.2.1 修正了自循环连线被节点遮挡和详情页「新建」误用编辑目标的问题，并校正 TAKT 上游“系统会自动提交/推送”的提示。本 App 不会自动执行 Git 操作。0.2.2 随包补齐桌面回归与对话验证脚本，运行行为和 UI 延续 0.2.1。

测试使用本机原有权限设置，没有改动权限模式。当前来源会话为完全放行；本次未另行实测用户手动拒绝工具授权的交互。

**实现与交付物**

- [App 源码与使用说明](../apps/takt/README.md)
- [当前安装 ZIP](../artifacts/moss.takt/0.2.2/moss.takt-0.2.2.zip)，约 2.85 MB；包含构建产物、源码、锁文件和 SDK 来源资料。仅本地交付，未发布到远端市场。
- [打包元信息](../artifacts/moss.takt/0.2.2/moss.takt-0.2.2.release.json)
- [实际对话查询截图](../artifacts/moss.takt/0.2.2/verification/conversation-query.png)、[工作流库](../artifacts/moss.takt/0.2.2/verification/library.png)、[窄窗口](../artifacts/moss.takt/0.2.2/verification/compact.png)

ZIP SHA-256：`ac447952ec87bfd689e9ae8c94ba2794253fb314e035aa23a43567416ef13412`。

固定 `takt@0.70.0`，在构建时替换 Agent runner / Provider 注册入口并调整资源定位；实际调度、条件和并行仍由 TAKT 引擎执行。所有 Agent 调用，包括内部判断，经过 Moss Tasks / Execution。引擎在每个 run 的 Worker 中执行，Backend 保存记录并调用 Host，UI 使用 ReactFlow 展示 App 统一运行模型。构建检查阻止外部 Claude/Codex 执行 SDK 被打入运行包。

**已明确的边界**

这是本次 Moss 对话、运行和图展示范围的可用版本，并非 TAKT CLI 全功能移植。暂不支持拖线编辑、子工作流、外部 facet、command/system 节点、定时触发、独立 stdio MCP 控制入口，以及跨进程断点恢复。

关闭 Moss 或重启 Backend 后，失去执行能力的在途任务会结束为中断/取消状态；保留结果并允许按原修订重跑，不自动重放可能已有副作用的步骤。同一进程内的暂停可以继续。App 不提供逐 token 文本、思考过程或完整实时工具参数流。

每个运行限制为最多 30 分钟、128 次 Agent 调用、并发 4、50 万 token；定义必须包含 1–64 的 `max_steps`。目前实际验证平台为 macOS Apple Silicon，Manifest 最低 Host API 为 `^3.11.0`，未宣称其他平台已经验证。

复验命令见 App 的 `scripts/verify-host.mjs`、`scripts/verify-desktop-regression.mjs` 和 `scripts/verify-conversation.mjs`。后两个会操作实际 Moss；对话脚本会使用配置中的真实模型，并保留新增记录。
