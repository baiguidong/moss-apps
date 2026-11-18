# 语义知识库

独立 Moss App `moss.knowledge-rag@0.1.13`，与现有 `moss.library` 并存。资料保存在本机，提供多语言语义与关键词混合检索。首次安装默认只在选择此 App 的会话中提供工具。

引擎来自 [lyonzin/knowledge-rag](https://github.com/lyonzin/knowledge-rag)（MIT），本轮分析参考 commit `df9cccb396a5452f77affb4b0f824e55b9c2e7f4`，实际运行锁定 PyPI 4.11.0。

## 使用

1. 在包含 `moss.host/v1 tools.scope.get/set` 的新版 Moss 中安装 App（本轮 Core 开发版本，Host API >=3.6.0）。在“更多”打开“语义知识库”。
2. 首次使用时，查看准备页的“Moss 内置 Python”状态。如果显示“未就绪”，先在 Moss 中安装或启用 Python。选择“在线准备”或“选择离线包”后，App 用 Moss 提供的 Python 在当前实例的数据目录创建私有虚拟环境 `python-env`（venv）。App 用这个 venv 的 Python 安装依赖、准备约 130 MB 的多语言模型并启动检索引擎。后续启动复用已就绪的 venv，从本机加载模型。
3. 导入文件，等待索引完成。支持 Markdown、TXT、PDF、DOCX、XLSX、PPTX、CSV、JSON 及常见代码格式；每个文件最多 50 MB，每次最多 200 个普通文件（系统选择器最多 100 个）。不接受目录或符号链接。原文件保持不变，同源重导入更新副本。
4. 用关键词或自然语言搜索，展开命中片段可复制原文和来源路径。点击文件名阅读正文，长文档可继续翻页。
5. 在会话中选择此 App 后使用 MCP 工具；也可在顶部“设置”中改为“全局”，或选择“跟随 App 默认”恢复默认范围。公共页面来自 `@moss/app-settings`，还提供 MCP 连接信息和工具目录。检索引擎配置仍由 App 内的“设置”进入。切换按 App 统一作用于全部 MCP 工具。全局未选中时按需发现，选中后常驻；改回指定会话后，未选择它的会话不再获得工具。正在执行的会话下一轮生效。

准备页显示 Moss 基础解释器的可用状态，就绪时可看到路径末三段及 Moss 返回的版本信息。准备和启动过程分为运行环境、引擎依赖、模型准备、本地服务、索引恢复、连接 Moss 六步。页面显示步骤耗时、模型文件处理量和最近输出。30 秒没有新输出时会提示等待，服务健康检查超过 3 分钟会报错并保留出错步骤。准备支持取消和重试，已完成的下载会复用。macOS 可沿用系统 HTTP/HTTPS 代理，本机 MCP 连接直连。

页面沿用 Moss 的颜色、字体、控件与明暗主题，支持网格、点阵和渐变背景，并随宿主外观事件即时更新。

范围设置由 Host 持久保存，默认声明仍是 session；不改写安装包，不代表自动检索每个问题，也不会绕过工具权限。旧客户端缺少该 Host 方法时，页面明确报告范围设置不可用。后台不能调用该 UI-only 方法自行扩大范围。

### 选择在线或离线安装

两种方式使用相同的 App ZIP、版本和知识库。在线准备通过 pip 配置的软件源安装依赖（默认 PyPI），从 Hugging Face 下载下方固定版本的模型。

内网客户可在联网电脑下载 `moss.knowledge-rag-0.1.13-offline-darwin-arm64.zip`，将整个文件复制到内网。此试点适用于 Apple Silicon Mac 和带内置 Python 3.13 的 Moss 桌面版。新电脑请同时带入相应的 Moss 安装程序。

1. 解压整个离线包。在 Moss 应用页点“本地安装 ZIP”，选择解压目录内的 `moss.knowledge-rag-0.1.13.zip`。
2. 打开“语义知识库”，点击“选择离线包”，选择同目录的 `offline.json`。请保留相邻的 `wheels/` 和 `model/` 文件夹。
3. 等待准备完成即可导入、索引和搜索本地文档。日常启动复用本机环境和模型。需要补装或修复时可再次选择整包。网页导入还需要能访问目标网页。

### 页面与原生 MCP 工具

| 页面入口 | 可执行的操作 | 引擎工具 |
| --- | --- | --- |
| 我的资料 | 按分类和数量浏览已索引文档，打开正文或复制库内路径 | `list_categories`、`list_documents`、`get_document` |
| 搜索与检索选项 | 查看证据、相关度和匹配方式，设置语义权重、最低分数、结果数、片段长度、包含或排除的目录，选择混合或 FTS5 全文检索 | `search_knowledge` |
| 阅读资料 → 相似资料 | 以当前文档为参照查找其他资料，查看相似度并打开原文 | `search_similar` |
| 新建文档 / 从网页导入 | 写入文本或抓取网页，选择分类并立即索引。网页标题可自定义，生成的路径相同时会更新该副本 | `add_document`、`add_from_url` |
| 阅读资料 → 编辑原文 / 移除资料 | 编辑完整的 UTF-8 文本源文件。移除时可保留文件或同时删除库内副本，保留的副本可在后续索引时重新出现 | `update_document`、`remove_document` |
| 索引任务 | 查看文档和片段数量、缓存命中率、当前进度及上次结果。可执行增量索引、智能重建、从检查点恢复或全量重新嵌入 | `get_index_stats`、`get_reindex_status`、`reindex_documents` |
| 检索评测 | 输入多组问题及预期文档路径，查看逐题排名、MRR@5 和 Recall@5。评测使用引擎默认参数 | `evaluate_retrieval` |

## 实现

- persistent Node Backend 托管一个带随机 Bearer 的 127.0.0.1 HTTP MCP 服务；所有会话和页面共享同一个索引进程。关闭页面继续运行，停用 App/退出 Backend 停止；意外丢失父进程时 Python 监督线程终止服务。
- 通过 `moss.mcp/v1` 注册服务及原生 13 个 MCP 工具；页面调用明确 Backend Actions，不另外注册重复 AI 工具。`mcpSecrets` 由 Host Credential Vault 保存，页面不收到 token。
- 固定 knowledge-rag 4.11.0、ChromaDB 1.4.0、FastEmbed 0.8.1、MCP 2.0.0、ONNX Runtime 1.26.0；全量带哈希锁见 `resources/requirements.lock`。普通 App ZIP 携带依赖锁与模型哈希。离线整包另外携带对应平台的 wheels、模型权重和分词器。文档、索引与 venv 保存在各实例的数据目录。
- 模型是 `intfloat/multilingual-e5-small` 的 `Xenova/multilingual-e5-small` 量化 ONNX 导出，固定 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`，384 维，mean pooling、归一化，query/passage 前缀由上游应用。FastEmbed 公共 custom-model API 注册。页面搜索语义权重 0.7，关闭英文重排器。MCP 原生工具保留上游参数默认值（hybrid_alpha=0.3）；要复现本报告，请显式传 hybrid_alpha=0.7、max_results=5、snippet_mode=false。
- 后端通过 `moss.runtimes/v1` 的 `python.get` 获取基础解释器路径，用它执行 `-m venv`。随后用 venv 的 Python 按 `resources/requirements.lock` 安装依赖并校验哈希。启动时，后端确认 venv 的解释器存在，且 `python-env/ready.json` 中的引擎版本和锁文件哈希与当前版本匹配，才会复用该环境。
- venv 的 Python 依次执行 `resources/prepare_model.py` 和 `resources/run_engine.py`。首次准备从固定的 Hugging Face 快照或所选离线包复制到实例的 `engine/models`，按 App 内 `resources/model.lock.json` 校验 SHA-256。后续启动校验本地文件，以离线模式加载模型。模型文件缺失或损坏时需要重新准备。
- 上游 4.11.0 的 preflight 会在空库中建立 default embedding collection，导致真正的自定义 embedding 初始化冲突。`run_engine.py` 将该探测改为只读取已有 collection；其余锁、恢复及检索代码保持上游实现。已有不兼容索引仍报错，不删除或伪装模型身份。

## 当前边界

首版为 macOS Apple Silicon 交付并实测，其他平台未验证。Mac 使用 CPU。文档按分类和目录组织，引用使用库内相对路径。文本编辑器一次读取完整源文件（最多 12 万个 UTF-16 代码单元），保存前核对文件摘要。PDF 和 Office 文档可阅读解析后的内容，更新时可重新导入原文件。列表由页面后端对上游全量列表分页，大库仍有全量读取成本。扫描件的解析不含 OCR。

## 开发与验证

仓库根目录 `bun install`，然后：

```sh
bun run --cwd apps/knowledge-rag check
bun run --cwd apps/knowledge-rag test
bun run --cwd apps/knowledge-rag test:model
bun run --cwd apps/knowledge-rag build
bun run --cwd apps/knowledge-rag test:preparation
node scripts/package-app.mjs --app moss.knowledge-rag
```

构建 macOS Apple Silicon 离线整包时，用 Moss 的 Python 3.13 执行以下命令。脚本从锁文件解析目标平台 wheels，校验模型的五个文件，输出离线 ZIP 和 SHA-256。已有完整资源时可传入 `--wheels <目录> --model-dir <模型快照目录>`。

```sh
"$MOSS_PYTHON_PATH" apps/knowledge-rag/scripts/package-offline.py artifacts/moss.knowledge-rag/0.1.13/moss.knowledge-rag-0.1.13.zip
```

真实引擎对比和桌面验证使用独立的测试数据。先将 `MOSS_PYTHON_PATH` 设为本机 Moss 受管 Python 可执行文件的绝对路径，然后在仓库根目录按以下步骤准备测试环境。示例适用于 macOS，检索对比使用 Node 22+ 的原生 SQLite。

```sh
export MOSS_RAG_TEST_CACHE="$TMPDIR/moss-knowledge-rag-test"
export MOSS_RAG_TEST_PYTHON="$MOSS_RAG_TEST_CACHE/venv/bin/python"
"$MOSS_PYTHON_PATH" -m venv "$MOSS_RAG_TEST_CACHE/venv"
"$MOSS_RAG_TEST_PYTHON" -m pip install --require-hashes -r apps/knowledge-rag/resources/requirements.lock
"$MOSS_RAG_TEST_PYTHON" apps/knowledge-rag/resources/prepare_model.py "$MOSS_RAG_TEST_CACHE/models" --allow-download

bun run --cwd apps/knowledge-rag compare
bun run --cwd apps/library build
bun run --cwd apps/knowledge-rag test:desktop
```

对比脚本优先使用 `MOSS_RAG_TEST_PYTHON`，也可用 `MOSS_RAG_TEST_MODELS` 单独指定已准备好的模型目录。桌面验证要求设置 `MOSS_RAG_TEST_PYTHON`，并将 `$MOSS_RAG_TEST_CACHE/venv` 和 `$MOSS_RAG_TEST_CACHE/models` 链接到临时 App 实例。省略 `MOSS_RAG_TEST_CACHE` 时，测试脚本默认使用仓库的 `.cache/knowledge-rag`。桌面验证默认从相邻的 `../moss` 加载 Core 和 Electron，也可用 `MOSS_CORE_ROOT` 指定 Core 目录。报告位于 `artifacts/moss.knowledge-rag/comparison/`，包含冻结语料、逐题原始结果、可筛选的 HTML 与截图。

项目流程见 `docs/knowledge-rag-app-plan.md`，代码审查与修复见 `REVIEW.md`。
