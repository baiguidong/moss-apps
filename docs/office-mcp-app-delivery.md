# 文档、Excel 与数据库 MCP App

> 数据库查询已于 0.2.0 升级为动态连接 App，可在页面中直接配置、保存和测试，无需手写 TOML。当前说明见 [数据库 README](../apps/database/README.md)。以下保留 0.1.0 的交付记录。

2026-10-13，macOS Apple Silicon。新增三个配置型 App，沿用 `app.json + marketplace.json + resources/`，由 Core 提供公共设置页、工具目录、会话选择和进程管理，没有增加 App Backend。

| App | 固定上游 | 真实发现工具 | 首次使用 |
| --- | --- | --- | --- |
| `moss.markitdown@0.1.0` | `markitdown-mcp==0.0.1a7` | 1 | Core 准备 Python 依赖；本地文件使用绝对 file URI |
| `moss.excel@0.1.0` | `excel-mcp-server==2.0.0` | 42 | Core 准备 Python 依赖；默认允许用户主目录，可修改 `--allow-dir` |
| `moss.database@0.1.0` | `@bytebase/dbhub@1.5.0` | 2（随包模板） | 创建 TOML 配置，在 App 连接配置中填写 `MOSS_DATABASE_DSN` |

三个 App 默认 `toolScope: session`，位于设置 → 工具，声明可空闲回收。包内含配置源码、资源、固定 Core 生成器与构建依赖锁；运行时上游包首次使用时下载，顶层版本固定，传递依赖遵循上游约束。MarkItDown MCP 当前上游版本仍为预发布版。首版市场只声明实测的 `darwin-arm64`。

## Core 配套修复

真实 Excel 2.0.0 的 `serverInfo` 除 name/version 外还返回 title、websiteUrl、description。原 Core 将整个对象直接放进严格的 App 协议，导致服务已握手却在 `servers.inspect` 输出校验失败。本轮让 Host 只投影协议声明的 name/version，缓存和列表保持相同结构。

文档转换的 Python 依赖首次准备曾耗时约 119 秒，随后空缓存 Desktop 测试又超过原 120 秒安装限制。Python 包安装等待延长为 240 秒，两处服务检查从原来的 65/60 秒延长为 300 秒，并相应调整安装锁等待时间，覆盖依赖准备和 MCP 握手；其他配置请求仍保留原超时。

修复位于相邻 `moss` 仓库，已同步到本仓库 `vendor/moss-core` 工作副本，并保留 [完整补丁](office-mcp-core-compatibility.patch)。Core 的 25 项 MCP Host 与路径绑定测试通过，包含额外服务信息字段的回归测试；公共 MCP 页面的 TypeScript 检查通过，页面及 Desktop 运行模块已重新构建。正式发布前，需将 Core 修复发布并固定到可获取的子模块提交，当前交付为本地开发包，未签名或发布市场。

## 实际验证

- 文档转换：通过真实 MCP 调用转换 DOCX、PDF、PPTX、XLSX；验证中文、空格、`#` 的 URI 编码，以及文件不存在时返回错误。
- Excel：创建工作簿、写入和读取数据、SUM 计算、图表创建；独立检查 XLSX 内实际保存的公式与图表 XML；拒绝目录外写入和符号链接逃逸。
- 数据库：临时 SQLite 的表结构和查询；1005 行数据按模板截断为 1000 行；拒绝 INSERT、DROP，验证原数据仍保留；连接地址读取脱敏，空值保存保留原凭据。
- 三个 ZIP 均安装到临时 Core 配置，检查入口、App 身份、工具选择、重启后配置与数据、停用、权限撤销和卸载。真实 Desktop 使用生产 preload 与公共页面，完成连接配置保存、工具发现、浅色/深色/窄窗口截图。
- 最终 Core 修复后，删除本轮 MarkItDown 虚拟环境，以禁用 pip 缓存的真实下载重新验证 Desktop 首次启动：首次自动检查即成功，无需重试或修改配置；本次从启动到完成界面验证约 77 秒，耗时随网络变化。
- 仓库 `./scripts/*.test.ts` 的 72 项测试通过，三个源码包的独立重建验证通过。

验证使用合成文件、临时数据库和隔离的 App 配置，不读取用户业务文件或连接用户数据库。Python 实测使用 Moss 受管 3.13.15；Node 命令行 22.22.0，Desktop 受管 22.22.2。脚本缓存仅保存本轮下载的公共运行依赖。

初次执行 `bun test scripts` 会同时匹配 `artifacts/` 内旧源码快照，出现 19 个旧快照失败；改用明确的根目录测试路径后，72 项全部通过。没有修改这些历史快照。

## 运行与复现

```sh
node scripts/package-app.mjs --app moss.markitdown
node scripts/package-app.mjs --app moss.excel
node scripts/package-app.mjs --app moss.database

node scripts/verify-source-package.mjs --app moss.markitdown --rebuild
node scripts/verify-source-package.mjs --app moss.excel --rebuild
node scripts/verify-source-package.mjs --app moss.database --rebuild

node scripts/verify-office-mcp.mjs
../moss/ui/node_modules/.bin/electron scripts/verify-office-mcp-ui.electron.mjs
```

两个实际服务验证脚本均支持 `--app moss.markitdown|moss.excel|moss.database`。可用 `MOSS_CORE_ROOT` 指定完整 Core checkout。命令行验证优先使用已安装的受管 Python，可通过 `MOSS_PYTHON_PATH` 指定解释器；Desktop 验证在临时运行时目录链接现有运行文件，注册信息与用户配置隔离，可用 `MOSS_TEST_RUNTIME_HOME` 指定现有运行时目录。

DBHub 第一次 npx 下载在本机超过连接等待时间，曾导致一次连接超时；下载完成后的真实检查、调用和重连均通过。新环境可提前执行以下命令完成依赖准备，再打开 App 配置数据库；它只下载运行包并打印 Node 版本，不启动数据库连接：

```sh
npm exec --yes --package=@bytebase/dbhub@1.5.0 -- node --version
```

安装 ZIP、`verification.json`、`desktop-verification.json` 与截图分别位于：

- [文档转换产物](../artifacts/moss.markitdown/0.1.0/)
- [Excel 产物](../artifacts/moss.excel/0.1.0/)
- [数据库产物](../artifacts/moss.database/0.1.0/)

## 已知边界

MarkItDown 上游没有目录白名单，按运行用户权限读取文件；基础文档转换不包含扫描件 OCR 或版式重建承诺。Excel 使用显式允许目录而非会话工作目录，不保证跨会话同时编辑同一文件；公式覆盖不等同于完整 Excel 引擎。DBHub 的只读与行数限制来自模板，用户自定义配置会改变行为；SQLite 不应用上游的 `query_timeout`，其他数据库驱动本轮未连接实测。
