# Git 仓库

配置型 MCP App。Moss Core 提供页面、注册、Python 环境和调用前的目录校验；Git 操作来自官方 `mcp-server-git==2026.8.18`。App 不包含独立 UI 或 Backend；官方服务和依赖随平台安装包提供。需要 **Host API 3.11**。

默认只操作当前会话的 workspace。`repo_path` 可省略；显式提供相对路径时在 workspace 内解析，也可提供公共仓库的绝对路径。workspace 不是仓库时返回 Git 错误，不自动回退公共仓库；可显式选择 workspace 内的子仓库。没有会话目录时必须显式指定已授权的公共仓库。空范围可以检查和列出工具，不能操作仓库。

设置中的公共仓库目录可留空，最多 32 个已有仓库根目录，支持 `~/`。Git 默认从 Moss 运行环境的 PATH 查找，也可填写程序的完整路径，不附带参数。旧版目录、Git 程序路径、禁用工具、服务启停和身份在升级时保留。

## 运行与兼容性

`app.json` 启动包内 `runtime/launch.cjs`，由它调用 Moss 内置 Python 3.13 运行 `runtime/site-packages/` 内的官方 Git 服务。运行时不创建 venv、不调用 pip、不下载依赖，App 安装包不包含 Python 解释器。构建机需要 Python 3.13，可用 `MOSS_BUILD_PYTHON` 指定；实际依赖版本记录在 `runtime/python-bundle.json`。

`roots` 保存范围，`pathBindings` 将 `repo_path` 绑定到会话默认目录，并在每次工具调用前检查真实路径和仓库根目录。官方服务的 Roots 不承担权限校验，Core 在 SDK 请求边界执行检查。公共仓库必须显式选择；不同会话使用独立连接。

保留官方 12 项工具名称。固定上游的结果格式和参数限制与旧 Node 适配不完全相同：Core 清除继承的 Git 环境覆盖、禁用 Git 子进程的 hooks/fsmonitor 和提交签名，并以字面路径暂存；提交身份继续使用 Git 配置。GitPython 自行执行提交钩子，因此存在提交钩子时拒绝该提交；存在外部 diff/textconv 配置时拒绝相关差异操作，提示使用常规 Git 客户端，不执行这些外部程序。其余 Git 行为遵循上游及仓库配置；旧版每个 Git 子进程 30 秒、2 MiB 的限制不再作为上游执行保证，工具调用受 Core MCP 超时和结果处理约束。目录检查不是操作系统沙箱。

## 构建与验证

```sh
node scripts/package-app.mjs --app moss.git
node scripts/verify-source-package.mjs --app moss.git --rebuild
node scripts/verify-git.mjs --previous-archive artifacts/moss.git/0.1.1/moss.git-0.1.1.zip
```

安装包位于 `artifacts/moss.git/0.1.5/moss.git-0.1.5-<platform>.zip`。相邻 Core 仓库提供 `MOSS_TEST_GIT_MCP=1 bun test src/services/mcp/git.integration.test.ts`，验证实际工具、范围和重连。开发期间 vendor/moss-core 的包源码需与 Core 同步。

上游：https://pypi.org/project/mcp-server-git/2026.8.18/ 。许可证原文位于 `resources/assets/licenses/mcp-server-git-LICENSE.txt`。
