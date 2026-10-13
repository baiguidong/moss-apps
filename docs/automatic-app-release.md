# 统一 App 自动发布

`Release Changed Apps` 扫描 `apps/*/app.moss.json` 和 `mcp-apps/*/app.json`，把仓库中尚未发布的新版本自动构建、签名、发布到 GitHub Releases，最后统一部署应用市场。

## 实施清单

- [x] 两类 App 共用应用发现、配置校验、版本比较和发布计划。
- [x] 配置型 App 使用 Core 生成器，保留完整源码、依赖锁、签名及独立重建门禁。
- [x] 发布绑定源码提交，使用可重试的草稿；已发布版本不可覆盖。
- [x] main 提交、每 6 小时检查和手动执行共用一个工作流；App 独立构建，最后统一更新市场。
- [x] 本地验证版本边界、分页、失败重试、包重建和市场生成。

## 目录与版本

| 类型 | 维护文件 | 构建方式 |
| --- | --- | --- |
| 普通 App | `apps/<name>/app.moss.json`、`package.json`、源码、资源、`marketplace.json` | 原有 App check/test/build |
| 配置型 MCP App | `mcp-apps/<name>/app.json`、可选 `resources/`、`marketplace.json`、`CHANGELOG.md` | 共用 `scripts/build-mcp-app.mjs` 调用固定 Core 生成器 |

配置型 App 不需要手写 package.json、构建脚本或 UI。导出源码包时自动补齐这些构建入口，随包携带生成器及锁定的 SDK/runtime 源码。运行内容仍是配置和资源，UI 与 MCP 进程生命周期由 Moss Core 提供。`source/` 中的构建代码不会作为 App Backend 执行，Core 要求它通过完整源码描述与摘要验证。

App 的版本就是发布意图，不根据代码差异自动提升版本。普通 App 同时更新 manifest 与 package.json；MCP App 更新 app.json。Draw.io 本次是 0.1.4，0.1.3 的本地产物保持原样。

| 与全部已发布 GitHub Releases 的比较 | 行为 |
| --- | --- |
| 新 App / 版本更高 | 进入发布矩阵 |
| 同一个版本已正式发布 | 跳过，绝不覆盖，即使元数据缺失 |
| 仓库版本落后 / 只有 SemVer build metadata 不同 | 提示并跳过 |
| 同版本存在本工作流的草稿 | 校验相同提交后补传缺少的文件 |
| 同一 App ID 出现在多个目录 | 停止计划，要求消除歧义 |
| 单个 App 的定义或市场信息有误 | 在计划中记录错误，其余有效 App 继续 |

稳定版只与稳定版比较。预发布版本标记为 GitHub prerelease，不进入稳定应用市场。API 分页完整读取；网络或鉴权失败会中止计划，不会误认为所有 App 尚未发布。

## 工作流

1. **plan**：检出固定提交，输出 `release-plan.json`、Actions summary 和待发布矩阵。
2. **release**：最多同时处理 3 个 App，`fail-fast: false`。根据声明的平台运行 macOS / Windows / Linux 源码构建与重建验证；保留浏览器 UI、Audit/Workflow Host、Computer Use Windows Electron 检查。
3. **publish**：验证 ZIP 签名、源码、App ID、版本、平台、提交 SHA、大小、SHA-256 和发布元数据。创建固定提交的 tag 和草稿，逐一上传并下载核对文件；全部一致才转为正式 Release。使用提交时间作为发布元数据时间，避免重跑造成内容变化。
4. **catalog**：即使部分 App 失败，也从已完成的正式 Releases 和 main 当前应用清单生成市场并部署一次；重跑旧任务不会误下架后来新增的应用。没有待发布版本时也会刷新目录，因而目录部署失败可单独重试。存在损坏的源定义时保留已发布元数据，避免误下架；正常情况下删除源目录仍会下架。
5. **result**：发布、目录部署或源定义有错误时，总流程显示失败，便于定位；已成功发布的 App 下次自动跳过。

`release-app.yml` 是复用工作流，`publish-catalog.yml` 是复用/手动工作流，不再依赖每个 App 的 workflow_run 触发市场部署。自动流程只运行 main。整批发布和目录部署分别串行，防止多批任务相互覆盖。

## 本地操作

```sh
# 只读查询 GitHub，输出可审阅计划；没有发布动作
bun run release:plan

# 也可使用离线 GitHub Releases 数组进行比较
node scripts/plan-releases.mjs --releases-file /tmp/releases.json --output /tmp/release-plan.json

# 两类 App 使用同一个打包、验证入口
node scripts/package-app.mjs --app moss.drawio
node scripts/verify-source-package.mjs --app moss.drawio --rebuild

# 临时 Git 仓库 + 临时测试密钥，离线验证真实签名包及发布输入
bun run release:smoke

# 编排与目录回归测试；显式路径避免匹配 artifacts 内的历史源码
bun test ./scripts/*.test.ts
```

Actions → **Release Changed Apps** → **Run workflow**，默认 `dry_run=true`，只生成计划。取消 dry_run 后执行实际发布。推送 main 和定时任务自动发布；不再要求手工推 tag。

重试上传失败的任务时，使用原 Actions run 的 **Re-run failed jobs**，它仍绑定原提交。草稿不允许换成另一提交，也不覆盖其中的冲突文件；如果确实需要换源码，应提升版本。tag 指向不同提交、未知草稿、已有资产内容不同，均保留现场并失败。

`publish-release.mjs` 是实际写入 GitHub 的入口，仅由工作流在校验后调用。初次实现时仅进行了本地验证；线上执行状态以 Actions 和 Releases 为准。

## 上线前提与验证边界

- Core 对配置型 App 的 publisher、源码随包与安装校验支持已提交到 `da234bfedf66105ccbf74b640b020cd1e4abbc07`，并推送到 Core main。moss-apps 子模块固定到此提交，Builder SDK 来源记录同步更新；签名门禁仍拒绝脏源码。
- 使用已有 `MOSS_APP_SIGNING_PRIVATE_KEY` Actions Secret、`publishers/moss/release-1.pem` 公钥及 GitHub Pages 配置；Core 客户端须含 Host API 3.9 的配置型 App 支持。
- 本地验证覆盖真正的签名与重建、普通 App 回归及模拟 GitHub 发布重试。macOS Intel / Windows / Linux 托管 runner 和线上部署由首次 CI 运行验证。
- 锁文件固定的是包内生成器与构建依赖。Draw.io 仍按配置运行 `npx -y @drawio/mcp`，实际启动时解析第三方服务版本；如需固定服务版本，应在 app.json 明确写入 npm 版本。

## 本轮验证记录

- 仓库脚本回归：62 项通过；最终签名字段校验调整后，13 项发布与 MCP 专项复验通过。
- Core MCP 安装/资源/源码安全：7 项通过；源码描述校验：1 项通过。
- Draw.io 0.1.4：本地 ZIP 打包、解压后独立重建一致；临时干净仓库和临时 Ed25519 密钥的真实签名包也验证通过。
- 当时的普通 App `moss.sequential-thinking` 0.1.2：检查、5 项业务测试、打包、Backend 握手和 ZIP 独立重建通过。0.1.3 已转为 `mcp-apps/sequential-thinking/` 下的配置型 App，使用相同的配置包发布流程。
- 四个相关 Actions workflow 通过 actionlint；冻结锁文件安装通过。
- 只读扫描 GitHub 得到 20 个待发布 App，包含 Draw.io；计划保存在 `artifacts/automatic-release/plan.json`。日志保存在同目录。该记录来自首次本地验证；线上发布状态以 Actions 为准。

2026-10-13 发布跟进：普通 CI 按 `--supported-platform` 区分通用包与原生包；电脑操控在 macOS/Windows runner 构建，Linux 继续检查全部 App 的类型与业务测试。Core 全量桌面测试通过 1170 项及 24 项 Node 测试。
