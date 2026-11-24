# RAG 知识库接入 PDF 创作 OCR

安装 `moss.anything-rag` 时，Moss 检查并复用兼容的 `moss.pdf`。缺少依赖时，安装页提供一并安装选项。导入扫描件时，用户选择原始 PDF，知识库调用「PDF 创作」的离线 OCR，把逐页文字建立索引。普通文件和有文字层的 PDF 直接走现有导入流程。用户跳过依赖安装时仍可使用普通导入。

## 0.1.2 联调结果

- CDP 在独立 Moss 实例验证了真实安装授权页。修复前 `apps:invoke` 已保存，UI 直调成功，界面触发的 App Backend 调用被 Host 误判为跨 App 多跳。修复后 Host 根据调用方 App 和实例身份识别真正的入站跨 App 调用，PDF OCR 使用独立工作会话。
- 使用知识库 0.1.2 和 PDF 创作 0.3.5 验证了普通 PDF 与扫描件一起导入、逐页 OCR、原文读取和检索。关闭重开知识库后导入另一份扫描件，仍使用安装时的授权。此前失败的《6、昆仑通态硬件手册.pdf》已在测试实例中识别两页并建立索引。
- 主动撤销授权后，新的 OCR 请求被拒绝，重建索引仍可复用已保存的 OCR 正文。知识库 12 项测试、Core 19 项回归测试及两侧检查通过。
- 运行前提为包含调用路由修复的 Moss Host，以及已安装并启用的「PDF 创作」。组合安装与跨 App OCR 任务取消见后续实施步骤。

## 初始接口验证

- 在临时 Core Runtime 安装本机的 `moss.pdf@0.3.5` 包和测试用调用方。通过 UI Host API 用一页纯图像 PDF 实测了 `pdf_import` → `pdf_create` → `pdf_status` → `pdf_inspect`。用 `chi_sim+eng` 完成离线识别，读取到第 1 页及样本中的预期英文文字。
- 在只安装调用方时，工具发现返回 `not_installed`。修复前工具链成功时，Host 为 PDF 创作创建工作会话，桌面 Main 同时发送 `app:open-session`。[会话存储](https://github.com/baiguidong/moss/blob/main/ui/src/apps/app-session-storage.mjs) · [桌面会话创建](https://github.com/baiguidong/moss/blob/main/ui/src/main.mjs)
- 修复前，用与桌面直调 Action 相同的 `surface: 'app'` 从调用方后端请求 OCR，Core 返回 `APP_PERMISSION_DENIED` 和 `Nested cross-App calls are not supported`。[跨 App broker](https://github.com/baiguidong/moss/blob/main/packages/app-runtime/src/app-capabilities/index.mjs) · [桌面 Action 入口](https://github.com/baiguidong/moss/blob/main/ui/src/apps/app-ui-requests.mjs)

## 能力声明与安装

联调用以下 Manifest 字段。`^3.23.0` 与已验证 PDF 包的 Host API 要求一致。[跨 App 工具契约](https://github.com/baiguidong/moss/blob/main/ui/docs/app-capabilities.md) · [PDF 创作 Manifest](../apps/pdf-tools/app.moss.json)

```json
{
  "hostApi": "^3.23.0",
  "host": {
    "protocols": ["moss.host/v1", "moss.runtimes/v1", "moss.local-files/v1", "moss.app-capabilities/v1"]
  },
  "permissions": ["local-files:pick", "local-files:open", "apps:invoke"],
  "appCapabilities": {
    "usesTools": [{
      "appId": "moss.pdf",
      "tools": ["pdf_import", "pdf_create", "pdf_status", "pdf_inspect"]
    }]
  }
}
```

安装审核展示目标 App 和工具授权，包含导入文件与创建 OCR 任务产生的写入。发现工具时使用 `listTools({ appId: 'moss.pdf' })`，在任务中调用 Host 签发的 `toolRef`。工具升级或引用到期时重新发现，并在调用前核对实时工具 Schema。

`usesTools` 已支持跨 App 工具授权。安装时解析包版本、复用已装包及下载缺失包，使用另行规划的组合安装机制。首轮联调在已经装好 PDF 创作的 Moss 运行，组合安装接着用同一对 App 验证。[组合安装设计](digital-human-app-v0.1-plan.md#组合安装)

- 依赖安装计划包含目标 App ID `moss.pdf`、可信发布者、兼容版本范围与各平台经验证的签名包。兼容且启用的包直接复用，缺失时列出待装版本和新增权限。用户确认后，由 Host 先安装依赖再激活调用方。停用、撤权和版本不兼容有各自的状态提示。
- 离线测试使用签名清单绑定的两个独立 ZIP，按顺序校验、暂存和激活。失败或取消时回退本次组合变更。升级或卸载知识库后，公共 PDF App 可继续为其他调用方服务。首轮验收先跑 macOS Apple Silicon，再在 Linux x64 验证同样的版本和调用约束。

## 导入和索引

| 阶段 | 调用与结果 |
| --- | --- |
| 判定 | 知识库对用户所选 PDF 执行现有本地文字提取。解析结果明确为无可用文字时进入 OCR。文件损坏、加密或读取错误按各自原因处理。首版覆盖整份扫描件，混排 PDF 的缺字页按页补识别另行验收。 |
| 交接 | `pdf_import({ paths: [managedPath] })`。传入本次导入已校验的知识库受管副本，使用返回的 PDF 文件 ID。工具授权、实例路由和审计走 Host。 |
| 识别 | `pdf_create({ fileIds: [id], options: { mode: 'ocr', language: 'chi_sim+eng' } })`。记录 PDF 任务 ID，通过 `pdf_status` 查询进度。在知识库任务页显示 OCR 阶段和识别页数。 |
| 读取 | 成功后用 `pdf_inspect({ id: taskId, page, limit: 1 })` 读取正文和页码，按页避开跨 App 回复上限。正文为空时记录 OCR 失败并继续批次。 |
| 建索引 | 保存 OCR 后的正文与原页码，继续切片、embedding 和写入索引。检索证据引用知识库内的原始 PDF。OCR 文本随文档版本保存并记录原文件 SHA-256、识别语言及提供方版本，重建索引时复用匹配的正文。 |

单文件沿用知识库的 50 MiB 限制，单次 OCR 遵守 PDF 创作的 80 页上限。任务开始前检查页数，结束后释放临时产物。结果较多时验证 `pdf_status` 的完整回复大小，Host 当前限制单次工具结果为 768 KiB。需要精简时，由 PDF 创作提供仅返回任务阶段、进度和页数的状态接口。[OCR 引擎](../apps/pdf-tools/src/backend/engine.mjs) · [Host 大小限制](https://github.com/baiguidong/moss/blob/main/ui/docs/app-capabilities.md)

## 实现顺序

1. **先跑通 App 依赖联调。** 用现有四个工具验证真实包、授权、异步任务和原文读取。当前 Host 上可由知识库 UI 通过官方 UI SDK 直调，作为联调入口。
2. **接入后台自动导入。** Core 用 Host 可信调用来源区分 App 界面直接触发的 Action 与另一 App 派发的入站 Action，保留真正跨 App 多跳的限制。为后台调用按 owner、调用方和提供方实例分配工作会话，同时保留 PDF 创作正常的会话入口。知识库统一在导入后端完成判定、调用、取文和索引，界面和 Agent 使用同一条导入路径。[进程派发](https://github.com/baiguidong/moss/blob/main/packages/app-runtime/src/process/index.mjs)
3. **把 OCR 作为正式依赖交付。** PDF App 的 `pdf_create` 同时允许其他 PDF 操作，正式授权可以由单独的 OCR 提交工具收窄到 OCR。将已有 `tasks.cancel` 暴露为相应的跨 App 取消工具，知识库取消时停止轮询并按任务 ID 取消已开始的 OCR，超时与撤权各自提示，按文件保留成功结果。随后接入市场和离线组合安装。

## 验收

| 场景 | 验收证据 |
| --- | --- |
| 首装、已安装和缺依赖 | 独立 Moss 用两个真实包测试首次安装。已装 PDF App 复用一次，跳过安装仍能导入普通 PDF。缺失、停用、撤权和不兼容时扫描件有明确提示。 |
| 普通 PDF 与扫描件混合导入 | CDP 从「导入资料」批量选择普通 PDF 和两页扫描 PDF。审计显示普通 PDF 直接索引，扫描件走四个工具。扫描件识别出的中英文关键词可检索，正文与页码对应，知识库仍打开用户导入的原 PDF。 |
| 后台与会话 | CDP 观察 OCR 进行中仍在知识库窗口，现有 PDF 创作会话中的任务与新 OCR 工作会话数据相互独立。验证真正的多跳调用仍被 Host 拒绝。 |
| 取消、超时和重试 | 取消时 PDF 任务进入终态，清理临时数据。超时或授权变化只使当前文件失败。重新导入可成功，内容指纹一致时重建索引复用已保存的 OCR 正文。 |
| 组合安装与更新 | 验证已有版本复用、缺包补安装、无网双包安装、版本不兼容提示和失败回滚。检查安装审核能看到目标工具范围。 |
