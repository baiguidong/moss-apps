# 语义知识库：代码 review 与修复记录

日期：2026-10-12。按规划、规划 review、开发、代码 review、修复、汇总顺序实施。本记录是实现后的自审及真实运行验证，没有独立审查者签名。

## 审查结论

本轮范围已实现：新增独立 App，默认 session，App 内可切到 global；Host 保存有效范围，原生工具和 App 所属 MCP 工具统一执行。现有知识库保持并存。已完成源码重建、真实引擎和桌面验证；本地开发包适用于包含本轮 Core 修改的 Moss，不代表已经发布市场。

## 发现与修复

| 问题 | 修复 | 验证 |
| --- | --- | --- |
| 多会话 stdio 会重复启动索引写入进程 | persistent Backend 持有单个带随机 Bearer 的本机 HTTP MCP 服务，页面与会话共享 | 真实两个 HTTP 客户端访问同一进程；退出 Runtime 后确认 Python PID 消失 |
| 上游 4.11.0 preflight 在空库创建 default embedding collection，与真正的 FastEmbed 配置冲突 | 将该探测改为只读已有 collection；不创建、不删除已有索引 | 空库首次启动、索引、重启后阅读 |
| 多语言 E5 不在 FastEmbed 内建目录；首次查询下载模型可能超时 | 用公开 custom-model API 注册，固定 ONNX revision，启动前下载；引擎离线加载 | CPU ONNX 实际检索、文件 SHA-256 校验、重启复用 |
| macOS Python 下载未沿用系统代理；Xet 下载停滞 | 解析系统 HTTP/HTTPS 代理，保留 NO_PROXY 本机地址；禁用 Xet 下载 | 模型完整下载，真实私有 venv 安装 |
| uv 生成的锁剥离 extras，Python 3.11 自带 pip 22.3.1 在 require-hashes 下仍尝试解析未固定版本 | 重新生成包含 extras 的完整 hash lock；App 私有 pip 缓存、60 秒网络超时和有限重试 | `KnowledgeService.install()` 使用 pip 成功；`pip check` 无损坏依赖 |
| 只检查 ready.json 存在会误用旧版或不完整环境 | 同时检查引擎版本、requirements SHA-256 和 Python 文件；原子保存标记 | 锁文件变化及损坏标记回归 |
| macOS `/var` 与 `/private/var` 别名导致成功导入后误判来源越界 | 先将受管文档目录解析为真实路径，再生成配置和校验来源 | 目录别名单元测试、真实 Electron 导入 20 份资料并显示 |
| Backend 重启注册同名 MCP 服务被 Host 拒绝 | 先读取已有目录，再用 previousName 更新端口和 token，保留用户启用状态 | 真实 ZIP 安装后 Backend 重启、服务重新连接、13 个工具发现 |
| 仅改 Manifest 或 UI 文案无法实现用户范围；后台可调用会扩大自身能力 | Host 管理用户/App 级覆盖，get/set 仅允许 UI 且不能提交其他 appId | 持久化、用户隔离、输入契约及 Host surface 回归；实际 UI session → global → session |
| 忙碌期间 global → session，原生调用入口使用当前值，而 MCP 使用旧快照，行为不一致 | 原生工具也保存运行时范围快照；下一轮重建；显式移出会话仍立即撤销选择授权 | 原生快照回归与 MCP reload 回归 |
| 导入取消可能留下已提交但未索引的副本；子进程 close 已发生后再等待会挂住 | 合并动作/生命周期取消信号；启动增量扫描恢复副本；spawn 时记录完成 Promise | 取消/重导入回归、进程结束回归、真实关闭清理 |
| 异步搜索/阅读及初始 scope 读取可能覆盖较新结果；阅读层缺少键盘模态行为 | 请求序号与取消保护，scope 加载期间禁用选择，原生 dialog 管理焦点及 Escape | 类型检查、桌面搜索/阅读/切换、深浅色和 760 px 截图 |

## 验证证据

- Core：8 个相关测试文件共 **43 项通过**，覆盖 Host 请求、scope 持久化/隔离、MCP 注册与过滤、运行快照、会话选择、忙碌重载。
- App：**7 项测试通过**；TypeScript、Vite、Backend bundle、Manifest 与包校验通过。
- 独立源码重建：从随包源码使用冻结锁文件安装依赖，执行 check/test/build，再完成 Backend 握手。
- 首次准备：真实 `venv → pip --require-hashes` 安装，不依赖开发用 uv 环境冒充安装成功；证据 `artifacts/moss.knowledge-rag/comparison/install-verification.json`。
- 真实评测：20 份冻结合成文档、32 个问题；真实 ChromaDB + CPU ONNX、两个 HTTP 客户端、重启和正文阅读；没有调用 LLM。
- 桌面：实际 ZIP、Core Runtime、生产 preload 与 UI 请求 broker，两个真实 App 页面。仅文件选择器固定返回测试语料；使用预装测试 Python/模型缓存避免重复下载。范围切换检查真实 MCP 服务可见性，关闭检查子进程退出。证据 `desktop-verification.json` 和 `screenshots/`。
- 契约生成、SDK 类型/公开契约导出均通过 `--check`。

## 保留的产品边界

1. 首版只实测和声明 macOS Apple Silicon；不据此宣称其他系统可用。
2. 全局表示所有本地会话可按需发现此 App 的全部工具，允许多个 global App；不设置唯一默认知识库，也不自动对每个问题检索。
3. 无答案问题可能返回无关候选；本次 4 个无答案问题均出现误召回。不能把相似度当事实可信度，也没有验证 LLM 答案质量。
4. 主比较是页面参数：hybrid_alpha=0.7、max_results=5、snippet_mode=false。原生 MCP 保留上游默认 alpha=0.3，复现时需显式传主比较参数。
5. 资料集管理、页面文本编辑、revision 冲突和 Moss URI 引用仍是现有知识库更完整；新 App 暂未复刻。上游列表是全量返回，页面分页不消除大库全量读取成本。
6. 模型和 Python 依赖首次需要联网下载，之后本地检索；模型/环境不在 ZIP 中。网络失败保留可重试状态和已完成下载。

## 0.1.1：引擎等待反馈与 Moss 外观

- 准备、自动启动及手动重试共用六阶段状态，状态查询与事件均包含当前步骤、总耗时、步骤耗时、真实模型文件字节数、最近输出。阶段尚无可量化总量时使用不定进度，避免展示估算百分比。
- Python 使用无缓冲输出。推理组件加载、索引预检查均在执行前回报；服务健康检查超过三分钟明确失败。依赖与模型准备命令最多十分钟；网络连接使用有限超时与重试。30 秒无新输出仅提示等待，不将日志静默直接判断为失败。
- 取消结束子进程并等待当前操作收尾，失败步骤保留诊断；再次重试创建新状态。输出限制长度、删除 URL 中的凭据/参数及 Bearer 值。
- 模型按文件校验，完整缓存不访问网络，损坏时只修复受影响文件。实际 658 字节配置文件下载验证了进度回报，完整模型缓存也验证通过。
- 页面使用 Moss 标准主题变量、字体、控件尺寸及背景，订阅宿主 appearance 事件；准备期间集中展示状态，避免同时出现不可用的搜索与空资料列表。

验证：10 项 Node 测试、1 项 Python 缓存/损坏修复测试、浏览器准备/取消/启动/重试/错误/就绪与主题切换测试通过；1160、760、480 宽度视觉检查通过。实际 ZIP 通过冻结源码重建、类型检查及 Backend 握手，Electron 验证 20 份资料导入、索引、搜索、阅读、范围切换、重启和进程清理。隔离空库使用现有 Python 3.13 环境启动约 4.1 秒，该计时不包含首次依赖/模型下载，也不代表用户已有大库的启动耗时。

更新包：`artifacts/moss.knowledge-rag/0.1.1/moss.knowledge-rag-0.1.1.zip`。验证截图与真实启动记录：`artifacts/moss.knowledge-rag/preparation/`。本轮未发布应用市场或替换正在运行的用户实例。
