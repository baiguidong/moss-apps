# AnythingLLM RAG 独立 Moss App 迁移方案

状态：独立实验 App 初版已实现并完成构建、测试和 source package 验证；尚未替换现有 `moss.library` 或 `moss.knowledge-rag`。

日期：2026-11-17

## 目标

在 `apps` 下新建一个独立的实验 App，暂定 ID 为 `moss.anything-rag`，显示名为“RAG 知识库（实验）”。它从 AnythingLLM 迁移成熟的文档处理、embedding、向量检索、rerank、拒答、上下文组装、引用和索引任务能力，同时采用 Moss 的 App Backend、Action、Tool、Resource Provider、权限和数据目录契约。

新 App 与现有两个 App 并存：

- 不覆盖 `moss.library`；
- 不覆盖 `moss.knowledge-rag`；
- 不读取或修改它们的数据目录；
- 不改变现有安装包、Manifest、工具选择和发布记录；
- 通过独立测试和对比报告决定是否将来替换现有 App。

第一版的目标是验证中文 RAG 质量和 AnythingLLM RAG 迁移价值，不追求还原 AnythingLLM 的完整产品平台。

## 成功标准

新 App 必须在 Moss 中独立安装、启动和卸载，具备自己的完整工作台，并满足以下条件：

1. 可以导入中文 Markdown、TXT、PDF、DOCX、XLSX、PPTX、HTML、CSV、JSON 和常见代码文件。
2. 使用多语言 embedding；不能将 AnythingLLM 默认的英文 `all-MiniLM-L6-v2` 作为中文默认模型。
3. 支持向量检索、SQLite FTS5/BM25 关键词检索、结果合并、threshold、topK 和可选二次排序。
4. 当前版本先支持 query refusal、来源引用、revision 防误删和受管文档；pinned documents、会话临时附件、context window 和 source curation 后续补齐。
5. 搜索结果带 `resourceId`、Moss URI、revision、snippet、score、来源和页码/行号（解析器能提供时）。
6. 导入、解析、embedding 和重建索引具有进度、取消、失败诊断和重试能力。
7. 同一个 persistent Backend 服务多个会话和页面，不能为每个会话重复启动 embedding/vector 进程。
8. UI 使用 Moss 主题、字体、语义颜色、浅深色和窄窗口布局，但交互密度和信息层级接近 AnythingLLM。
9. 在固定中文语料上，Recall@5、MRR@5、无答案误召回率和引用准确性不低于现有 `moss.knowledge-rag` 基线，或者明确记录未达标原因。
10. 新 App 的测试和安装包完成后，现有 App 仍能正常构建和使用。

## 不在本轮范围内

本轮不迁移 AnythingLLM 的完整产品平台：

- 用户、登录、邀请、SSO、多用户 Workspace ACL；
- AnythingLLM 自己的 LLM Provider、聊天历史和线程存储；
- Memory、Scheduled Tasks、Agent Flow、MCP 管理；
- 全部远程向量数据库和全部 embedding Provider；
- Community Hub、白标主题、移动端和浏览器扩展；
- 外部 Embed Chat，除非核心 RAG 验证通过后单独立项。

Moss Agent、会话、模型、工具权限、MCP、Memory 和定时任务继续使用 Moss 的能力。

## 目标架构

```text
Moss Host
  ├── App UI（React/Vite，独立工作台）
  └── persistent Node Backend
        ├── Moss Actions
        ├── RAG service
        ├── SQLite metadata store
        ├── document parser / splitter
        ├── embedding worker
        ├── FTS5/BM25 index
        ├── local vector index（SQLite JSON vectors，便于 App 独立分发）
        ├── optional reranker
        └── resource provider（moss-rag://）
```

Backend 使用 App 私有 `dataDir` 保存：

```text
dataDir/
├── app.sqlite
├── documents/
├── parsed/
├── models/
├── vectors/
├── fts/
├── exports/
└── jobs/
```

## 初版落地范围

`apps/anything-rag` 已落地以下可运行能力：中文文本分块、TXT/Markdown/HTML/CSV/JSON/PDF/Office/代码解析、Multilingual E5 embedding adapter、SQLite FTS5 与向量混合检索、阈值拒答、文档 revision、资源 URI、导入/重建任务、取消、失败状态、私有副本删除、知识空间和独立 React 工作台。当前仍是实验版：没有 OCR、URL 导入、真正的中文 reranker 或 Moss Agent 流式回答，原生 embedding 依赖不可用时会显示回退向量模式，评测时必须把该状态排除在语义质量结论之外。

embedding 模型和 reranker 不进入 App ZIP。首次准备时下载到 App 私有目录，并记录版本、模型 revision、文件 SHA-256 和 embedding 维度。第一版支持本地多语言模型；远程 OpenAI-compatible embedding 作为后续 adapter，不阻塞本地验证。

## AnythingLLM 迁移清单

来源路径：`/Users/bgd/repo/anything-llm`。

| 源模块 | 迁移方式 |
| --- | --- |
| `server/utils/EmbeddingEngines/native` | 迁移 Native Embedder 的模型加载、cache、batch、prefix 和下载状态；改为 App 配置和 dataDir |
| `server/utils/EmbeddingRerankers/native` | 迁移 rerank 接口和批处理；第一版默认关闭，中文 reranker 单独评估 |
| `server/utils/TextSplitter` | 迁移分块、overlap、metadata header；增加中文段落/标题边界测试 |
| `server/utils/vectorDbProviders/base.js` | 保留 provider contract；第一版只实现本地 LanceDB adapter |
| `server/utils/vectorDbProviders/lance` | 迁移 similarity search、threshold、topN 和 rerank 候选集逻辑 |
| `server/utils/chats/stream.js` | 只抽取 retrieval、pinned docs、source window、context compression 和 refusal；删除 LLM/SSE/WorkspaceChats 依赖 |
| `server/utils/DocumentManager` | 保留 pinned/context token cap；改为 RAG store 查询 |
| `server/utils/EmbeddingWorkerManager` 和 `server/jobs/embedding-worker.js` | 改为 App job manager 和受控 child worker，保留进度、取消、失败隔离和重试 |
| `collector/processSingleFile` | 迁移文件转换器和 metadata 规范；按依赖大小分阶段启用 |
| `collector/processLink` | 后续作为 `links.import`，第一版可先支持单页 URL |
| `server/jobs/sync-watched-documents.js` | 改成 watched source job，先支持本地文件，网页同步后置 |

删除或替换：

- Express endpoints、middleware、Swagger；
- Prisma schema 和 AnythingLLM 用户/Workspace/聊天模型；
- `STORAGE_DIR` 全局路径约定；
- LLM connector 和 AnythingLLM API session；
- `writeResponseChunk`、SSE response 和前端 REST client；
- AnythingLLM AuthContext、PrivateRoute、Login、Onboarding、Admin；
- Provider/Model 选择器、成员管理、Agent/Memory/Tools 菜单；
- 其他与 RAG 无关的 server/collector 依赖。

## Moss App 目录和契约

```text
apps/anything-rag/
├── app.moss.json
├── assets/icon.svg
├── package.json
├── schemas/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── theme.css
│   ├── components/
│   ├── lib/api.ts
│   └── backend/
│       ├── main.mjs
│       ├── service.mjs
│       ├── store.mjs
│       ├── retrieval/
│       ├── embedding/
│       ├── vector/
│       ├── parsers/
│       └── resource-uri.mjs
├── tests/
└── scripts/
```

Manifest 初版建议：

- `category: "knowledge"`；
- `navigation.location: "more"`；
- `toolScope: "session"`；
- `backend.lifecycle: "persistent"`；
- 需要 `moss.local-files/v1`、`moss.runtimes/v1`（若使用受管运行时）和 `moss.host/v1`；
- 不复制 `knowledge-rag` 的 MCP 工具注册，优先使用 Moss 原生 App Tools；需要外部复用时再提供 MCP 服务。

Action 初版：

```text
engine.status
engine.prepare
engine.cancel
spaces.list/create/update/delete
documents.list/read/delete
documents.search
files.pick
files.import
links.import
index.rebuild
jobs.list/cancel/retry
settings.get/update
resource.resolve
```

Agent 工具初版：

```text
rag.list
rag.search
rag.read
rag.import
rag.reindex
```

搜索结果统一返回：

```json
{
  "resourceId": "doc_123",
  "uri": "moss-rag://resource/doc_123?revision=4",
  "title": "续费政策",
  "snippet": "……",
  "score": 0.87,
  "sourceId": "source_9",
  "revision": 4,
  "page": 3,
  "lineStart": 120,
  "lineEnd": 148
}
```

## UI 方案

UI 参考 `apps/knowledge-rag` 的 Moss 适配方式和主题实现，但不保留当前简单的单列表页面。页面采用“知识空间 + 文档 + 对话 + 检索诊断”的完整工作台。

页面结构：

```text
左侧：知识空间、文档、任务、设置
中间：对话或搜索主工作区
右侧：Sources / Citation / 调试详情
```

主要页面：

1. **知识空间**：空间列表、文档数量、索引状态、最近任务。
2. **RAG Chat**：流式回答、线程、拖拽上传、临时附件、来源侧栏、引用详情。
3. **Documents**：文件、URL、metadata、pinned、watched、版本和重新索引。
4. **Retrieval Settings**：embedding、hybrid 权重、topK、threshold、rerank、拒答策略。
5. **Jobs**：解析、embedding、索引进度，支持取消、重试和失败原因。
6. **RAG Diagnostics**：候选 chunk、向量分数、关键词分数、rerank 分数、最终 context 和拒答理由。

UI 约束：

- 沿用 `knowledge-rag` 的 `theme.css`、appearance 监听、Moss 语义颜色、字体和线性图标；
- 不重复绘制 Moss 外框已经提供的 App 名称和简介；
- 页面边距 12–16px，正文 13–14px，区域间距 12–16px；
- 宽屏使用主工作区 + 来源侧栏，窄屏按对话 → 来源 → 设置顺序堆叠；
- 主输入、文档列表、结果和引用占据首屏，环境准备和低频设置收进状态区或弹层；
- 使用真实 Action 和 Backend 状态，不用静态占位数据通过 UI 检查。

## 中文检索方案

第一版不使用 AnythingLLM 默认的英文 `all-MiniLM-L6-v2`。候选策略：

1. 本地多语言 E5，使用正确的 `query:` / `passage:` 前缀；
2. 向量检索与 SQLite FTS5/BM25 合并；
3. 中文按标题、段落、句子和 token 上限分块；
4. 对产品名、编号、代码标识符保留精确关键词通道；
5. 默认关闭英文 ms-marco reranker；
6. 后续评估多语言 reranker；
7. 没有有效证据或所有结果低于 threshold 时拒答。

评测覆盖：

- 中文精确问法；
- 中文自然改写；
- 同义词和口语问题；
- 中英混合；
- 产品编号、代码标识符和专有名词；
- 多文档联合问题；
- 无答案问题；
- 需要页码/行号的引用问题。

## 分阶段实施

### 阶段 0：冻结基线和创建空 App

- 复制 `knowledge-rag` 的 App 构建、测试、桌面验证和主题结构；
- 创建独立 `moss.anything-rag` Manifest、package、schemas、README；
- 保持 `knowledge-rag` 和 `library` 工作区不变；
- 固定 AnythingLLM 版本、MIT 许可和迁移来源清单；
- 记录当前语义知识库的 Recall@5、MRR、延迟、内存和 UI 截图。

### 阶段 1：抽取 RAG Core

- 抽取 splitter、native embedding、vector contract、Lance adapter；
- 建立独立 `rag-core` 测试，不依赖 Express、Prisma 和 AnythingLLM server；
- 实现 SQLite FTS5/BM25 和向量结果合并；
- 完成中文模型加载、缓存、下载进度和重新索引判定。

### 阶段 2：Moss Backend 适配

- 实现 App 私有 store、document revision、resource URI 和 job manager；
- 迁移 parser/converter；
- 接入 persistent Backend、Action schema 和资源 provider；
- 实现单实例 embedding worker、取消、重试和重启恢复。

### 阶段 3：完整 UI

- 先做知识空间、文档、任务和检索设置；
- 再做 AnythingLLM 风格 RAG Chat、线程、附件和 SourcesSidebar；
- 增加 RAG Diagnostics；
- 完成浅色、深色、窄窗口和 Moss 外框截图验证。

### 阶段 4：效果对比

- 使用现有 comparison corpus 和新增中文业务语料；
- 与当前 `moss.knowledge-rag` 使用相同文档、问题、topK 和测试环境；
- 分别测 Recall@5、MRR@5、无答案误召回率、引用准确性、冷启动、热查询、索引耗时和 RSS；
- 不用 LLM 生成答案替代检索指标；
- 记录每道题的原始命中、分数、最终 context 和错误原因。

### 阶段 5：替换决策

只有在新 App 的中文检索和稳定性达到基线后，才讨论：

- 是否将新 App 改为正式名称和正式 ID；
- 是否迁移现有用户文件并重新索引；
- 是否把 `moss.knowledge-rag` 设为兼容维护；
- 是否废弃 `moss.library`；
- 是否补充 OCR、网页连接器、外部 embedding 和更多向量库。

## 验证和交付物

代码验证：

```sh
bun run --cwd apps/anything-rag check
bun run --cwd apps/anything-rag test
bun run --cwd apps/anything-rag build
node scripts/package-app.mjs --app moss.anything-rag
```

必须覆盖：

- Manifest 校验；
- Action 输入和错误边界；
- 中文 embedding 前缀；
- 文档导入、重复导入和 revision；
- 索引取消、失败、重试和恢复；
- 单 Backend 多会话；
- App 停止后子进程清理；
- 资源 URI 打开；
- `toolScope=session`；
- 浅色、深色、窄窗口和真实 Moss 外框。

最终交付：

- 独立 App 源码和依赖锁；
- 可重建 ZIP；
- AnythingLLM 迁移清单和第三方许可证记录；
- 中文检索对比报告；
- UI 截图和桌面验证结果；
- 已知限制和替换决策记录。

本方案完成后才进入代码迁移。新 App 的所有数据、构建产物和测试产物都放在独立路径，不触碰当前两个知识库 App。
