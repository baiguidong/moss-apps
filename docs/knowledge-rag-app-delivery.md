# 独立语义知识库交付与比较

日期：2026-10-12。已按「规划 → 规划 review → 开发 → review → 修复 → 汇总」完成。

## 交付结果

新增 `moss.knowledge-rag@0.1.0`（语义知识库），与 `moss.library@0.1.2` 并存。默认只在选择该 App 的会话提供工具，App 设置中可切到 global，再切回 session。Host 将选择持久化，统一影响原生/MCP 工具；正在运行的会话下一轮生效。global 允许多个 App 并存，不是唯一默认库选择器。

页面支持首次引擎准备/取消/重试、文件复制导入、索引进度、资料列表、自然语言搜索、正文阅读和范围设置。Node Backend 托管一个带鉴权的本机 HTTP MCP 引擎，页面和所有会话共用；13 个原生 MCP 工具由 Host 动态发现。

## 两款 App 的区别

| 维度 | 现有知识库 | 新语义知识库 |
| --- | --- | --- |
| 检索 | 中文分词 + SQLite FTS5 | 多语言 E5 向量 + BM25 混合检索 |
| AI 接入 | 5 个 Moss 原生工具 | 上游 13 个 MCP 工具，由 App 托管 HTTP 服务 |
| 页面 | 资料集、目录导入、文件导入、文本编辑、索引任务 | 文件导入、列表、搜索、阅读、索引、session/global 设置 |
| 引用/版本 | Moss 文档 URI、页码/行号上下文、revision 校验 | 上游来源路径、结果片段和正文；尚无等价的 Moss 引用/版本协议 |
| 首次准备 | 轻量，解析依赖随包 | 私有 Python 环境、锁定依赖及约 130 MB 量化模型下载 |
| 适用需求 | 整理资料、精确关键词、编辑与稳定引用 | 用户不知道原文用词、概念改写、多资料线索检索 |

MCP 更适合把 knowledge-rag 作为独立引擎接入和复用，协议本身不提高召回率。检索提升来自多语言模型与混合搜索。因此采用“独立 App + 自有页面 + 托管 MCP”，保留现有 App 的资料管理能力是本轮的落地方案。

## 同语料实测

Apple M1、CPU、20 份合成业务 Markdown，32 个预先冻结问题（28 个有答案、4 个无答案），双方 top-k=5。新 App 页面使用多语言 E5-small 量化模型、语义权重 0.7、关闭英文重排。未调用 LLM，评估的是检索。

| 指标 | 现有知识库 | 新语义知识库 |
| --- | ---: | ---: |
| 总体 Recall@5 | 44.6% | 91.1% |
| MRR@5 | 0.464 | 0.878 |
| 中文精确问题 Recall@5 | 100% | 100% |
| 语义改写 Recall@5 | 0% | 100% |
| 中英跨语言 Recall@5 | 0% | 60% |
| 代码标识 Recall@5 | 100% | 100% |
| 多资料问题 Recall@5 | 16.7% | 83.3% |
| 无答案时返回空结果 | 4/4 | 0/4 |
| 首次查询 p50 / p95 | 5.3 / 7.5 ms | 7.0 / 10.6 ms |

例：“老用户说下一年不想再买了，我们该怎么挽留”。现有 App 无结果，新 App 第一条为 `renewal.md`，可打开原文查到分期、培训、15% 优惠上限及回访时机。

必须同时看到代价：跨语言仍有失败；无答案时新库仍返回无关片段，需要核对证据。合成小语料不能替代生产评估；首次查询在索引完成后执行，不含下载；现有 App 计时是服务内调用，新 App 含 HTTP 往返，不能据此比较纯算法效率。原生 MCP 保留上游 alpha=0.3 默认值；要复现实测，显式传 alpha=0.7、max_results=5、snippet_mode=false。

RAG 引擎 Python RSS 实测约 569.6 MiB；Node 评测进程约 122.8 MiB，同时承载两个客户端与评测代码。这不是两个完整 App 的对等内存比较。

## 打开交付物

- [交互对比报告：分组过滤、逐题双方片段、真实页面截图](../artifacts/moss.knowledge-rag/comparison/report.html)
- [原始指标、环境、模型哈希与逐题数据](../artifacts/moss.knowledge-rag/comparison/results.json)
- [本地 App ZIP](../artifacts/moss.knowledge-rag/0.1.0/moss.knowledge-rag-0.1.0.zip)
- [App 使用与复现说明](../apps/knowledge-rag/README.md)
- [规划及规划 review](knowledge-rag-app-plan.md)
- [代码 review、修复和验证范围](../apps/knowledge-rag/REVIEW.md)

验证：Core 43 项测试、App 7 项测试、冻结源码重建及握手、真实 pip 安装、CPU 检索和桌面操作均通过。首次本地开发包需要包含本轮 Host 改动的 Moss；未安装到用户日常实例，未提交或发布应用市场。
