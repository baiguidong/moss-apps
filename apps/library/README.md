# 知识库

`moss.library` 是独立的本地 Moss App。管理资料集、导入文件与目录、编辑 Markdown/文本、全文搜索和查看索引任务。资料保存在 App 实例的数据目录；默认搜索全部资料集，指定 `collectionIds` 时才缩小范围。不依赖项目、会话、云端账号或模型服务。

## 使用

发布后可在 Moss 应用市场搜索「知识库」并安装 `0.1.1`，在应用管理中启用。需要包含下文通用 Host 协议的新版 Moss；现有旧客户端不具备这些协议。侧边栏入口和 5 个 AI 工具由 Manifest 的 contributions 注册，工具随 App 启停。

在应用中选择资料集，导入文件/目录或新建文档。导入保存独立副本；重复导入同一路径会更新副本。修改或删除资料库副本不会修改原文件。查询默认覆盖所有资料集。索引在后台执行，关闭页面不影响任务。

支持 Markdown、TXT、PDF、DOCX、XLSX、PPTX、HTML、CSV、JSON 和常用文本/代码格式。单文件最多 50 MB；目录最多 10,000 个文件、100 层，忽略隐藏目录、依赖和构建产物，不跟随符号链接。旧版 Office、扫描图片 PDF 的 OCR 和加密 PDF 不在本版解析范围内。可以直接编辑不超过 512 KiB 且 JSON 编码不超过 600 KiB 的 Markdown/TXT 副本。

## 开发和验证

在仓库根目录运行：

```sh
bun install
node scripts/run-apps.mjs build --app moss.library
node scripts/run-apps.mjs check --app moss.library
node scripts/run-apps.mjs test --app moss.library
node scripts/package-app.mjs --app moss.library
bun run --cwd apps/library test:desktop
```

`bun run --cwd apps/library dev` 可打开浏览器演示，演示数据仅保留在页面内存中。桌面验证默认使用相邻 `../moss` 仓库，可通过 `MOSS_CORE_ROOT` 指定。使用真实 Core Runtime、preload 和 EmbeddedAppView；数据及 Electron 配置均放在临时目录，原生文件选择和打开使用确定性测试响应。截图及结果在 `artifacts/moss.library/verification/0.1.1/`。可用 `MOSS_TEST_ELECTRON`、`MOSS_TEST_NODE`、`MOSS_TEST_PYTHON` 指定测试运行环境。

构建会下载并校验固定 SHA-256 的 `pypdf 6.1.1` 纯 Python wheel，随 App 打包其许可证。缓存位于 `.cache/`。运行时不执行 pip，不调用 LLM、embedding 或远程解析服务。

## Host 要求

需要本次 Core 变更新增的两个通用协议（Host API 2.3 的扩展机制，不修改 SDK 副本）：

| 协议 | 方法 | 用途 |
| --- | --- | --- |
| `moss.runtimes/v1` | `python.get` | 返回受管 Python 的可用状态与绝对路径 |
| `moss.local-files/v1` | `pick` | 选择文件或目录，返回绝对路径 |
| `moss.local-files/v1` | `open`, `reveal` | 打开/定位调用 App 数据目录内的文件 |

页面选择和打开文件分别声明 `local-files:pick`、`local-files:open`。这是通用 App 安装权限，不是项目或资料集 ACL。缺少 Python 时文档可保存，索引报告错误；完成 Moss 运行环境安装后重启 App，再重新索引。

## 工具与资源

Action 与 Tool 的完整输入契约在 `schemas/`，公共 Action 返回 `{ data: ... }`，错误通过标准 App RPC 错误返回。

AI 仅注册 5 个工具：

- `list`：列出资料集、来源或文档；`kind` 为 `collections`（默认）、`sources` 或 `resources`。
- `search`：全文搜索，默认全库；可指定 `collectionIds`。
- `read`：根据 `resourceId` 读取正文和版本。
- `write`：`operation=import` 时传 `collectionId` 和绝对 `paths`；`create` 时传资料集、标题和正文；`update` 时传文档 ID、版本和正文。
- `delete`：根据文档 ID 和版本删除托管副本、索引。

资料集管理、来源刷新、索引任务查看/取消、文件选择和打开仍是页面内部 Action，不作为独立 AI 工具注册。工具的列表/写入入口分别为 `library.list`、`library.write`；其余复用现有文档 Action。导入取消时，已经提交的副本保留，后续复制停止。

更新和删除工具要求读取时的 `revision`，并发修改会被拒绝。解析失败时，非文本阅读可能使用上一份成功索引：`revision` 是正文版本，`currentRevision` 是最新文件版本，删除此文档应使用后者。长文档用 `documents.read` 的 `nextOffset` 与 `chunkOffset` 分页读取；搜索结果含文档引用、页码/行号、命中块与相邻上下文。导入和写入返回任务后，通过 `jobs.list` 等待完成再搜索。关闭 App 或中断后，未完成的索引会在下次启动继续，包含已编辑的文档；主动取消的任务不会自动恢复。来源和资料集列表支持 `offset`/`limit`，完整响应中的 `nextOffset` 指向下一页；来源列表不包含内部文件配置。

`moss-knowledge://resource/<id>?revision=...` 由本 App 的 `resource.resolve` 解析成数据目录中的导出副本。Core 的通用 App 资源机制校验路径并打开引用，不认识知识库业务。

数据目录包含 SQLite（FTS5）、托管副本、解析缓存和导出副本。本版使用全新 schema，不读取或迁移原生知识库数据，不提供旧接口兼容。

## 发布验证

审查修复和回归证据见 [REVIEW.md](REVIEW.md)。发布使用 `moss.library-v0.1.1` 标签触发 GitHub Actions，CI 在 Node 22 下运行测试、构建并签名 ZIP，再更新应用市场。
