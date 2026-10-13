# Git 仓库 · Git

独立的 Moss Git App，沿用网页操控、记忆的模式，在设置 → 工具中管理公共仓库目录、Git 程序路径、排除工具与服务检查。启用后自动提供工具，无需 MCP 管理 App。会话 workspace 自动追加到当前 MCP 连接并优先使用，公共仓库目录可留空。

本机需要已安装 Git。每行填写一个已有仓库的根目录，最多 32 个，支持绝对路径和 `~/`；Git 程序路径留空时自动查找，或填写可执行文件的完整路径。保存时检查目录、Git 程序和仓库有效性，不会自动创建仓库或提交代码。清空公共仓库列表后仍可使用当前会话 workspace，工作文件和提交记录保留。

## 工具

提供与官方参考服务对应的 12 项工具：`git_status`、`git_diff_unstaged`、`git_diff_staged`、`git_diff`、`git_commit`、`git_add`、`git_reset`、`git_log`、`git_create_branch`、`git_checkout`、`git_show` 和 `git_branch`。

`repo_path` 可省略，默认使用当前会话 workspace，相对路径也在此解析；没有会话上下文时使用第一个公共仓库。可显式选择 workspace 内的仓库或配置的公共仓库。workspace 不是仓库时默认调用返回错误，不自动改用公共仓库。工具描述会列出当前默认目录及访问范围。提交沿用仓库 Git 配置中的姓名、邮箱；身份未配置时返回 Git 错误。`git_reset` 只取消暂存，保留工作文件；切换分支不强制丢弃修改。没有推送、克隆、清理文件、硬重置或任意 shell 命令工具。

需要提供 `moss.mcp/v1` 的 Moss Desktop（Host API ^3.4.0），授予 MCP 读取、管理和连接权限。“检查服务”启动独立的临时 Node MCP 进程，验证启动、握手和工具发现，不重启会话进程。关闭页面不停止服务。设置跨 App 更新和重启保留；忙碌对话在本轮结束后应用新的范围及排除工具设置。

## 官方接口的 Node 适配

以官方 Python 包 [`mcp-server-git@2026.8.18`](https://pypi.org/project/mcp-server-git/2026.8.18/) 的工具接口和行为为参考，移植到随包的 Node MCP 服务，调用本机 Git；无需安装 Python、uv 或 GitPython。这是 Moss 的适配实现，不是运行原 Python 服务。原参考源码、许可证和来源记录位于 `assets/licenses/`。

与参考实现的差异：支持多个公共仓库和当前会话 workspace 内的仓库。Host 通过运行时 `MOSS_SESSION_WORKSPACE` 注入当前会话目录，不写入公共配置；无会话上下文时服务检查仅使用公共目录，空范围也可列出工具。客户端 Roots 不扩大此范围。Git 通过参数数组调用，隔离继承的 `GIT_*` 环境覆盖，校验 revision 与暂存文件边界，按字面路径暂存文件。禁用 hooks、外部 diff/textconv 和自动提交签名；提交返回原生 Git 的结果与哈希。需要 hooks 或签名的工作流请在常规 Git 客户端完成。

每次 Git 子进程调用限制 30 秒、输出最多 2 MiB；日志最多 1000 条、diff 上下文最多 100 行。超限会返回错误，可缩小查询。单 MCP 进程中同一仓库请求串行执行，多进程使用 Git 自身的索引锁。Git 的全局及仓库配置仍负责身份等常规行为，此 App 不提供操作系统沙箱。

Node MCP 服务、SDK 和完整生产依赖随包，使用 Moss Node 运行时，不会在运行时下载依赖。实际依赖见 `dist/server/versions.json`，可重建源码随 ZIP 提供。

## 验证

```sh
bun install
bun run --cwd apps/git check
bun run --cwd apps/git test
bun run --cwd apps/git test:browser
node scripts/package-app.mjs --app moss.git
node apps/git/scripts/verify-host.mjs
```

测试在临时仓库验证全部 12 项工具、路径边界、参数校验、配置与重启。Host 验证安装最终 ZIP，用真实页面配置仓库并调用包内 Node 服务，在空 PATH、空 npm 缓存下使用已解析的 Git 完整路径运行。需相邻 Moss 仓库已构建 `ui/electron-direct.mjs`，也可通过 `MOSS_CORE_ROOT` 指定。报告位于 `artifacts/moss.git/verification/0.1.0/`。

本版本要求 Moss Host API >=3.4.0，展示入口为设置 → 工具 → Git 仓库。位置由 Manifest 声明；旧安装需要更新后生效。
