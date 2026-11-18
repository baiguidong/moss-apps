# 语义知识库

独立 Moss App `moss.knowledge-rag@0.1.9`，与现有 `moss.library` 并存。资料保存在本机，提供多语言语义与关键词混合检索。首次安装默认只在选择此 App 的会话中提供工具。

引擎来自 [lyonzin/knowledge-rag](https://github.com/lyonzin/knowledge-rag)（MIT），本轮分析参考 commit `df9cccb396a5452f77affb4b0f824e55b9c2e7f4`，实际运行锁定 PyPI 4.11.0。

## 使用

1. 在包含 `moss.host/v1 tools.scope.get/set` 的新版 Moss 中安装 App（本轮 Core 开发版本，Host API >=3.6.0）。在“更多”打开“语义知识库”。
2. 首次使用时，查看准备页的“Moss 内置 Python”状态。如果显示“未就绪”，先在 Moss 中安装或启用 Python。点击“准备引擎”后，App 用 Moss 提供的 Python 在当前实例的数据目录创建私有虚拟环境 `python-env`（venv）。App 用这个 venv 的 Python 安装依赖、准备约 130 MB 的多语言模型并启动检索引擎。后续启动复用已就绪的 venv，从本机加载模型。
3. 导入文件，等待索引完成。支持 Markdown、TXT、PDF、DOCX、XLSX、PPTX、CSV、JSON 及常见代码格式；每个文件最多 50 MB，每次最多 200 个普通文件（系统选择器最多 100 个）。不接受目录或符号链接。原文件保持不变，同源重导入更新副本。
4. 用关键词或自然语言搜索，点击结果阅读正文。长文档分页读取。
5. 在会话中选择此 App 后使用 MCP 工具；也可在顶部“设置”中改为“全局”，或选择“跟随 App 默认”恢复默认范围。公共页面来自 `@moss/app-settings`，还提供 MCP 连接信息和工具目录。检索引擎配置仍由 App 内的“设置”进入。切换按 App 统一作用于全部 MCP 工具。全局未选中时按需发现，选中后常驻；改回指定会话后，未选择它的会话不再获得工具。正在执行的会话下一轮生效。

准备页显示 Moss 基础解释器的可用状态，就绪时可看到路径末三段及 Moss 返回的版本信息。准备和启动过程分为运行环境、引擎依赖、模型校验或下载、本地服务、索引恢复、连接 Moss 六步。页面显示步骤耗时、模型文件下载量和最近输出。30 秒没有新输出时会提示等待，服务健康检查超过 3 分钟会报错并保留出错步骤。准备支持取消和重试，已完成的下载会复用。macOS 可沿用系统 HTTP/HTTPS 代理，本机 MCP 连接直连。

页面沿用 Moss 的颜色、字体、控件与明暗主题，支持网格、点阵和渐变背景，并随宿主外观事件即时更新。

范围设置由 Host 持久保存，默认声明仍是 session；不改写安装包，不代表自动检索每个问题，也不会绕过工具权限。旧客户端缺少该 Host 方法时，页面明确报告范围设置不可用。后台不能调用该 UI-only 方法自行扩大范围。

## 实现

- persistent Node Backend 托管一个带随机 Bearer 的 127.0.0.1 HTTP MCP 服务；所有会话和页面共享同一个索引进程。关闭页面继续运行，停用 App/退出 Backend 停止；意外丢失父进程时 Python 监督线程终止服务。
- 通过 `moss.mcp/v1` 注册服务及原生 13 个 MCP 工具；页面调用明确 Backend Actions，不另外注册重复 AI 工具。`mcpSecrets` 由 Host Credential Vault 保存，页面不收到 token。
- 固定 knowledge-rag 4.11.0、ChromaDB 1.4.0、FastEmbed 0.8.1、MCP 2.0.0、ONNX Runtime 1.26.0；全量带哈希锁见 `resources/requirements.lock`。Python 环境、文档副本、索引与模型不进入 ZIP。
- 模型是 `intfloat/multilingual-e5-small` 的 `Xenova/multilingual-e5-small` 量化 ONNX 导出，固定 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`，384 维，mean pooling、归一化，query/passage 前缀由上游应用。FastEmbed 公共 custom-model API 注册。页面搜索语义权重 0.7，关闭英文重排器。MCP 原生工具保留上游参数默认值（hybrid_alpha=0.3）；要复现本报告，请显式传 hybrid_alpha=0.7、max_results=5、snippet_mode=false。
- 后端通过 `moss.runtimes/v1` 的 `python.get` 获取基础解释器路径，用它执行 `-m venv`。随后用 venv 的 Python 按 `resources/requirements.lock` 安装依赖并校验哈希。启动时，后端确认 venv 的解释器存在，且 `python-env/ready.json` 中的引擎版本和锁文件哈希与当前版本匹配，才会复用该环境。
- venv 的 Python 依次执行 `resources/prepare_model.py` 和 `resources/run_engine.py`。首次准备将模型下载到实例数据目录的 `engine/models` 并记录 SHA-256，后续启动校验本地文件，再以离线模式加载模型。模型文件缺失或损坏时需要重新准备。
- 上游 4.11.0 的 preflight 会在空库中建立 default embedding collection，导致真正的自定义 embedding 初始化冲突。`run_engine.py` 将该探测改为只读取已有 collection；其余锁、恢复及检索代码保持上游实现。已有不兼容索引仍报错，不删除或伪装模型身份。

## 当前边界

首版为 macOS Apple Silicon 交付并实测，其他平台未验证。Mac 使用 CPU。文件内容解析不提供 OCR；目录/分类来自上游，没有复刻现有 App 的资料集管理、页面文本编辑或 revision 冲突协议。AI 原生工具可新增/更新/删除文档，遵循上游语义。列表分页是页面 Backend 对上游全量列表切页，大库仍有全量读取成本。返回 source 路径用于页面定位，没有注册 `moss-knowledge` URI，不会冒用现有知识库引用。

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
