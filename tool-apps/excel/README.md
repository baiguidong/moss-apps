# Excel 表格

配置型 App `moss.excel@0.1.3`。固定 [`excel-mcp-server==2.0.0`](https://pypi.org/project/excel-mcp-server/2.0.0/)，由 Core 提供设置页、Python 环境和 stdio MCP 连接。基于 openpyxl，无需安装 Microsoft Excel。

需要 Moss 内置 Python 3.13。构建时下载固定版本的服务与依赖，随对应平台 App 安装包放入 `runtime/site-packages/`。运行时通过包内启动器调用 Core Python，不创建 venv、不调用 pip、不联网准备依赖。安装包不包含 Python 解释器。

Core 还需包含新版 MCP 服务信息的兼容修复：Excel 2.0.0 返回额外的 title、websiteUrl、description，旧 Core 会在检查服务时拒绝这些字段。本轮已修复相邻 Core 与 vendor 副本，并随仓库保留 [兼容补丁](../../docs/office-mcp-core-compatibility.patch)。仅更新 App 不能修复旧 Core。

## 使用与目录

在会话中选择“Excel 表格”，可创建工作簿、读写单元格、编辑公式、工作表、表格与图表。支持 `.xlsx`、`.xlsm`、`.xltx`、`.xltm`，不支持旧二进制 `.xls`。默认不启用 VBA 写入，服务不执行宏。

默认参数 `--allow-dir ~` 限定当前用户主目录及其子目录，相对路径以主目录为起点，**不是当前会话工作目录**。在设置 → 连接配置中将 `args` 调整为所需目录，例如：

```json
["@app/runtime/launch.cjs", "stdio", "--allow-dir", "~/Documents", "--allow-dir", "~/Downloads"]
```

允许目录供使用此 App 的会话共用。上游检查解析后的路径，拒绝 `..` 和符号链接逃逸。删除全部 `--allow-dir` 参数会切换到上游的不受目录限定模式，届时只接受绝对路径。`EXCEL_FILES_PATH` 默认清空，避免继承父进程的额外允许目录。需要只读时可在参数最后增加 `--read-only`。

先读取再修改已有工作簿，重要编辑可保存到新文件。单个进程内的编辑由上游串行处理，但不同会话拥有独立进程，不提供跨进程文件锁；避免同时编辑同一文件。默认文件大小上限 100 MiB。公式能力以该版本上游支持范围为准，不承诺与 Excel 的完整重算引擎等价。

## 构建与验证

```sh
node scripts/package-app.mjs --app moss.excel
node scripts/verify-source-package.mjs --app moss.excel --rebuild
node scripts/verify-office-mcp.mjs --app moss.excel
```

包位于 `artifacts/moss.excel/0.1.3/`，按平台发布。源码包含依赖声明和构建脚本；构建机需要 Python 3.13，可通过 `MOSS_BUILD_PYTHON` 指定。实际构建依赖版本记录在包内 `runtime/python-bundle.json`。真实验证使用临时工作簿，覆盖读写、保存后重连、图表和目录拒绝。

上游：https://github.com/haris-musa/excel-mcp-server 。许可证原文位于 `resources/assets/licenses/excel-mcp-server-LICENSE.txt`。
