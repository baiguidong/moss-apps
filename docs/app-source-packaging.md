# App 源码随包发布规范

日期：2026-10-10。

规则已确定：后续所有新发布的 App 版本，以及 App Builder 创建或修改后每次本机安装的版本，都必须随安装内容携带完整、可重建、与版本绑定的源码。本文定义已接入的包格式、打包器、CI、Core 与 Builder 安装规则。每个版本是否发布及其验证结果，以不可变 Release 和应用市场元数据为准。

目标是让用户安装 App 后，点击“迭代”即可在对应版本的真实工程上修改，保留原有功能、构建方式和测试。一次增加请求模板的操作应只涉及相关业务文件。

## 1. 适用范围与硬性规则

- 适用于 moss-apps 维护的全部 App：UI-only、Backend-only、UI + Backend、纯 JavaScript 和含原生依赖的 App。市场发布、本地 ZIP 分发、Builder 首次本机安装及后续更新使用同一源码完整性规范。
- 市场发布的源码与运行产物必须在同一个签名 ZIP 中。Builder 直接安装可以不生成 ZIP，但源码必须进入已安装版本目录。本地包保留本地来源及 checksums，不因此获得市场签名信任。
- 仓库链接、GitHub 自动生成的仓库源码 ZIP、独立附件、source map、`dist/` 的重新压缩、会话工作区和构建缓存均不能替代版本目录内的完整源码。
- 必须包含构建、类型检查和业务测试所需的自有代码、配置、资源、脚本、锁文件及本地依赖。不得要求用户拥有 moss-apps / Moss Core 开发仓库，或依赖工作区外的绝对路径。
- 发布包中的源码必须真实生成本包运行产物。App ID、版本、源码摘要、运行产物摘要和构建环境必须对应，不能用当前 main 分支源码替代历史版本。
- 缺源码、缺构建依赖、锁文件不匹配、隔离重建失败或 Backend 无法完成握手，均阻止新版本发布或 Builder 安装提交。不得提供 `--without-source` 等绕过选项。
- 安装与源码检查只校验和读取文件；源码内的安装、构建与测试命令仅在用户发起开发任务、经现有 Agent 执行权限检查后运行。
- 现有已发布版本保持不可变。补源码必须提升 App 版本；旧包仍可按原有兼容规则安装、运行，但不能标为“源码完整、可直接迭代”。

## 2. 已接入的链路

| 位置 | 原行为 | 已实现 |
| --- | --- | --- |
| `scripts/package-app.mjs` | 收集 `dist`、schemas、assets、resources 和说明文件 | 导出完整源码快照，并把源码及描述文件纳入签名 |
| 仓库 workspace | App 使用 `workspace:*` SDK 和根目录 `bun.lock` | 包内恢复后仍能解析全部本地依赖，锁定第三方依赖 |
| Core 安装链路 | 市场安装将运行包再次存成 `sources/<version>.tar.gz`；Builder 另存源码快照 | 将完整源码与描述文件保存到安装版本内，统一处理来源与恢复入口 |
| Core `source.inspect/project.prepare` | 按单个目录根部的 manifest/package.json 判断源码 | 支持带 workspace 的源码快照，并保持项目绑定和未提交修改 |
| Core `build.start` | 当前构建入口固定使用 npm；源码复制排除生成的 SDK | 按声明选择受管包管理器，支持 Bun workspace 与固定 SDK 输入 |
| Builder 迭代 | 缺源码可能引发重复查找、重建工程和反复试错 | 明确处理源码缺失，直接恢复真实工程，返回具体构建/启动错误 |


## 3. 发布包与安装目录格式 v1

保留现有运行包布局，增加 `source/` 与 `source-manifest.json`。选择直接放目录，便于现有逐文件 checksums 与签名覆盖，避免再引入一层压缩归档。

ZIP 解包根与 `.moss/apps/<app-id>/versions/<version>/` 使用相同布局。Builder 直接安装也必须生成以下源码部分；`app-signature.json` 仅在存在真实发布者签名时收录。仅构建/预览而未安装的草稿可存于临时目录，安装提交后必须有独立持久副本。

```text
<app-id>-<version>.zip
├── app.moss.json
├── checksums.json
├── app-signature.json
├── dist/                         # 可独立运行的产物
├── schemas/
├── assets/
├── resources/                    # 按 App 需要
├── README.md
├── source-manifest.json          # 源码格式、路径、版本与构建记录
└── source/                       # 最小可重建 workspace
    ├── package.json
    ├── bun.lock
    ├── apps/<app-directory>/
    │   ├── app.moss.json
    │   ├── package.json
    │   ├── src/
    │   ├── scripts/
    │   ├── tests/                # 或项目既有的测试布局
    │   ├── assets/               # 构建输入
    │   ├── schemas/
    │   └── ...                   # Vite/TS 配置、HTML、许可证等
    ├── scripts/                  # 本 App 依赖的共享构建代码
    └── vendor/moss-core/packages/
        ├── app-sdk/
        └── host-contracts/
```

保持原有目录之间的相对关系，不为了导出而改写业务源码或重写 UI/Backend。非 workspace 的独立 App 可将工程直接放在 `source/`，其 `appRoot` 为 `.`。其他被构建或测试引用的本地包按依赖关系一同收录。

`source-manifest.json` 独立于 `app.moss.json`，避免未知 Manifest 字段被现有规范化逻辑丢弃。v1 必须定义以下字段及 JSON Schema：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 固定为 `1` |
| `appId`、`version` | 与包根和源码 App 的 manifest 一致 |
| `sourceRoot` | 固定为 `source` |
| `appRoot` | 相对 `source/` 的 App 工程路径；必须留在源码根内 |
| `origin` | 仓库发布记录 URL、完整提交 SHA 与原 App 路径；Builder 本地构建记录来源类型、构建引用及源码摘要，不要求草稿先建 Git 仓库，也不伪造提交 |
| `toolchain` | Node 版本、包管理器名称和精确版本、支持的构建平台 |
| `lockfile` | 相对源码根的锁文件路径；无第三方依赖也声明包管理器和确定的构建入口 |
| `commands` | install/check/test/build 的工作目录与参数数组；外部 Host 集成验证单独记录 |
| `sdk` | Core 提交、SDK 版本、SDK/contract 摘要和包内路径；存在其他本地依赖时记录对应清单 |
| `files` | 按相对路径排序的源码文件清单，含 SHA-256、大小与必要的可执行权限 |
| `sourceHash` | 规范化源码文件清单的摘要；排除时间、机器绝对路径等易变信息 |
| `runtimeHash` | 运行文件清单摘要，排除 `source/`、本描述文件、checksums 和签名，避免循环引用 |

源码目录及描述文件都必须进入根目录 `checksums.json`。市场包复用现有发布者签名，本地 Builder 安装将源码纳入不可变 artifactHash 和持久安装回执。市场索引可展示 `sourceIncluded/sourceFormat/sourceHash`，但 Core 只信任验证过的实际内容，不能只凭市场标签或存在归档文件判定源码完整。

## 4. 收录内容与依赖闭包

### 必须收录

1. App 自有 UI、Backend、worker、脚本等源文件，以及原有业务测试和非敏感 fixture。
2. `app.moss.json`、`package.json`、有效锁文件、构建配置、生成代码的输入与生成脚本。
3. 构建和测试引用的图片、样式、HTML、schemas、静态资源、第三方许可与说明文件。
4. workspace 根配置、必要的共享脚本和本地包。保留原相对布局，禁止剩余 `file:` 或 import 指向包外路径。
5. 固定 Core 提交导出的公共 SDK 和 host-contracts。若 App 构建依赖其他 Core 代码，先迁移到公共入口，或明确纳入可分发的构建依赖并完成隔离验证；不能把整个 Core 仓库作为隐藏前置条件。
6. 简短的 `source/README.md`，说明 App 入口、安装/构建/测试命令及需要外部 Host 的集成验证，方便 Agent 按入口执行。

### 不收录

源码目录排除 `.git`、完整 `node_modules`、既有 `dist/build`、覆盖率和缓存、开发日志、操作系统元文件、真实 `.env`、凭据、签名私钥及用户实例数据。可收录只含占位值且经过检查的配置示例。按显式文件规则收集，不对整个仓库盲目递归复制；路径穿越、符号链接及超限文件必须被拒绝。

### Bun workspace 与 SDK

只复制 App 的 `src/` 和 `package.json` 不满足要求。当前 App 通过 `workspace:*` 引用 SDK，构建及部分校验脚本也会读取 `vendor/moss-core`，而依赖解析来自仓库根锁文件。

导出器必须生成仅包含目标 App 和必要本地包的 workspace，并从原锁文件保留对应依赖版本及 integrity。导出后执行 `bun install --frozen-lockfile` 验证；若无法保持锁定结果，必须失败，不能退回非锁定安装或顺便升级依赖，也不能把全部其他 App 的源码和依赖都带入。

第三方依赖通过锁文件安装，源码随包不等于承诺首次构建完全离线。固定 SDK 源码快照由打包器自动生成，不在 moss-apps 手工维护第二套 SDK；导出时保留其本地依赖关系和所需许可证。

历史重建使用包内固定 SDK。后续迭代先检查当前 Core 能力；需要更新 SDK 时在草稿中明确迁移并更新依赖与锁文件，保留原快照，不静默覆盖发布时的 SDK。Core 现有 `.moss-sdk` 是生成目录，不能因其被源码复制规则排除而丢失历史构建输入。

## 5. 打包与 CI 门禁

发布流程固定为：导出源码快照 → 从快照隔离构建 → 收集本次运行产物 → 校验并签名 ZIP → 校验最终包 → 上传 Release。用于构建的源码快照和放入 ZIP 的源码必须是同一份。

Builder 本机安装走同等完整性流程：固定源码及 SDK 输入 → 隔离构建/验证 → 生成同时含运行产物和源码的不可变 artifact → `release.prepare` → `release.commit`。不需要额外签市场包或上传 Release，也不能因为没有 ZIP 而跳过源码校验。

| 门禁 | 验证内容 | 失败处理 |
| --- | --- | --- |
| 源码完整性 | 入口、脚本、资源、本地包、锁文件存在，路径和文件清单有效 | 给出具体缺失路径，阻止打包 |
| 身份与摘要 | 三处 App ID/版本一致，源码/SDK/运行产物摘要对应，源码未在构建期间改变 | 拒绝来源不一致的包 |
| 隔离重建 | 临时目录仅有导出的源码、受管工具链和锁定第三方依赖；不能读取两个开发仓库或父目录模块 | 禁止使用全局 SDK、现有 `node_modules` 或旧 `dist` 蒙混通过 |
| 业务验证 | 在恢复工程执行既有类型检查和业务测试；外部服务用明确测试环境或 fixture | 缺外部配置不能伪报通过 |
| 运行依赖 | 从仅含运行文件的目录启动真实 Backend，完成握手；原生依赖按声明平台验证 | 缺 SDK、模块、资源或握手失败均阻止发布 |
| UI 与 Action | UI 实际加载、现有关键交互和 Action 通过；沿用各 App 已有浏览器/Host 验证 | 返回具体错误和对应阶段 |
| 最终 ZIP | 验证源码清单、checksums、签名及快照/运行产物一致性；验包工具支持从 ZIP 独立重建 | 不依赖 staging 目录存在来判定合格 |

运行目录必须能脱离 `source/` 启动，防止开发依赖在源码树内“碰巧可用”。Backend SDK 应编入产物；确需外置的运行模块按现有 `dist/backend/node_modules` 规则打包。

打包器保留 `--skip-build` 参数的调用兼容性，但仍执行完整源码快照构建，不复用原工作区的 `dist`，不能跳过源码门禁。本地 `release.commit` 可复用该 artifact 的已完成验证，不必再次全量构建，但必须复核摘要与安装基准。正式仓库发布不接受 SDK 未提交快照冒充固定 Core 提交；Builder 本地安装按运行 Core 导出的实际 SDK 内容摘要保存来源。

Moss Core 与包格式定义必须共用验证规则，避免打包器判定可重建而 Core 无法恢复。新增文件数量和体积也计入现有安装包限制，不为携带源码静默放宽限额。

## 6. 安装与迭代衔接

1. Core 按现有流程校验市场 ZIP 的签名与 checksums，或本地 Builder artifact 的摘要与来源，再验证源码描述、内部路径和身份。单纯安装不执行源码脚本。
2. 将 `source/`、`source-manifest.json` 和运行产物一起写入该安装版本，原子提交安装状态与回执；失败或重启恢复时核对两者，不能报告只装好运行产物的版本为成功。另存的 `app-authoring/sources` 或 `sources/*.tar.gz` 可以作为派生缓存，不能成为唯一源码来源，也不能仅凭其存在判定可编辑。
3. `source.inspect` 返回明确的源码状态、`sourceRoot/appRoot`、工具链和可重建入口。旧 Core 的运行兼容性与是否支持恢复新源码格式分别判断。
4. `project.prepare` 首次恢复整个必要 workspace 到会话目录，返回 App 编辑目录、workspace 根、安装与构建入口；不扫描整台机器寻找源码。
5. 构建复制整个源码依赖闭包，在声明的 App 工作目录执行命令。Core 要同时更新项目持久化、源码 hash、快照、产物收集和恢复路径，不能只把 `source/` 下的 App 子目录复制出去。
6. 同一会话继续使用既有项目，保护未提交修改。新会话采用独立草稿；已安装版本变化时按现有版本/revision 冲突规则处理。
7. 缺少有效源码时，说明缺失项并提供选择匹配源码或升级至带源码版本的入口。Builder 不得把反编译或重新编写的工程标成原 App 的源码恢复；独立重写需用户明确提出。
8. 构建/预览失败向 Agent 返回阶段、退出码和经过处理的 stderr 摘要，例如 `Cannot find package '@moss/app-sdk'`，避免只返回泛化的握手失败。

源码保留周期与对应安装版本一致：已安装版本的源码不受临时作业/未安装产物的定期清理影响。删除原会话、workspace、构建缓存，或切换版本再回到该版本，都必须可以从安装目录恢复其真实源码。清理旧安装版本时才按该版本的现有删除策略一起清理源码；卸载流程沿用用户选择的数据保留规则。

Core 已支持受管 Bun 的锁定安装与 npm 的 `npm ci`，按源码描述中的精确工具链版本运行。优先复用版本匹配的本地 Bun，否则下载对应版本并保留缓存。Bun workspace 不会被换成 npm 工程；其他工具链明确返回不支持。源码声明的命令仍接受现有执行授权检查。

## 7. 迭代效率要求

- 同一版本源码仅在首次准备项目时恢复；后续修改复用绑定项目。
- 契约和 SDK 按 hash 复用，仅获取本次功能需要的接口，不反复加载完整目录。
- 依赖下载缓存按锁文件摘要、SDK 摘要、包管理器/Node 版本、OS/架构区分；复用前验证，变化后失效，不让多个草稿共享可写源码或同一个可写依赖目录。
- 构建入口直接返回 App 路径、构建方式和操作回执，减少模型猜测字段、寻找构建脚本和重复查询。
- 记录源码恢复、依赖安装、构建、预览握手、模型交互耗时。以功能和结构性指标验收，不承诺受模型延迟和网络影响的固定总秒数。
- 小修改的验收要求：不重写无关 UI/Backend、不反复恢复工程、不下载新 SDK 版本、不重做未变化的依赖解析；保留一次必要构建和相关功能验证。

## 8. 实施顺序

P0–P4 已完成，10 个应用均已逐个经 CI 构建并发布。Release 工作流先在 Apple Silicon、Intel macOS 和 Windows 上构建、验包并独立重建，再在 Linux 完成签名与发布；成功后自动刷新应用市场。

| 阶段 | 主要改动 | 完成标准 |
| --- | --- | --- |
| P0：格式与样例 | 在 Core 公共包契约中定义源码描述 Schema、摘要算法和路径规则；选定 workspace/独立工程样例 | moss-apps 与 Core 读取同一契约；必需和禁止项可验证 |
| P1：源码导出与打包 | 新增源码导出及验包模块，接入 `scripts/package-app.mjs`；导出最小 workspace 和锁定依赖 | 从快照构建的运行包包含完整源码；缺源码和污染输入被拒绝 |
| P2：Core 恢复与构建 | 更新 `app-platform.mjs`、`app-authoring-source.mjs`、`app-authoring-host.mjs`、开发目录及公共 API；支持 workspace、受管包管理器及源码/运行产物共同安装 | 市场 ZIP 和 Builder 本地安装均可从版本目录恢复源码；会话/缓存删除后仍能继续迭代 |
| P3：Builder 与 CI | 调整 Builder 入口提示、缺源码处理、错误返回及安装门禁；在 `ci.yml` 和 `release-app.yml` 强制执行发布门禁 | 普通 Agent 不再自行重写缺源码 App；未来发布和 Builder 安装都保证完整源码 |
| P4：存量迁移与正式启用 | 补齐现有 App 的导出输入，逐个提升版本；固定并推送 Core 提交和 SDK 子模块引用 | 各声明平台验证通过，市场版本包含源码；旧版本保持原样 |

首批已完成格式联调、隔离重建和市场发布。后续新版本继续执行相同门禁，不能只复制 `src/` 或补充仓库链接。

HTTP Client 仅为临时测试，按用户要求不纳入迁移或发布。迁移范围为当前其余 10 个 App；展示名称统一包括「应用构建」「MCP 管理」「调用追踪」。

每个发布版本通过 Git 子模块固定 Core 提交，写入 `source-manifest.json` 的 SDK 来源记录。首批使用 `8867f94880a2182c3f5a2d1d39db5e0d576f06d2`；后续 Windows 兼容修复使用 `810b42e89dc1bce48f6257f113acc2308f813582`。构建只校验包内 SDK 内容，不读取相邻开发仓库；SDK 版本相同也核对内容摘要。

## 9. 验收清单

- [x] 未来发布包同时包含运行产物、完整源码、构建入口、锁文件和固定 SDK；缺任一必要输入即失败。
- [x] Builder 首次创建并直接安装的版本目录同时包含运行产物与完整源码，不要求先导出 ZIP 或发布市场。
- [x] Builder 每次迭代安装保存与该版本产物匹配的源码；提交失败、进程中断、回滚时两者保持一致。
- [x] 源码、描述文件均被 checksums 覆盖；市场包同时受发布者签名保护，本地 Builder 安装同时纳入 artifactHash/安装回执；篡改任意一项会被发现。
- [x] 只解包到临时目录、开发仓库不可访问时，锁定安装、类型检查、业务测试、构建可以完成。
- [x] 独立运行目录不包含 `source/`、原工作区模块或全局 SDK，Backend 仍可握手；关键 Action 沿用各 App 的 Host/业务测试。
- [x] 旧无源码包可继续运行，新包仍受 `hostApi` 和 Host 能力约束；新增源码恢复及应用构建界面需要包含本次 authoring 改动的 Moss 客户端，不代表已经发布桌面安装程序。
- [x] 安装后能直接恢复真实源码；第二次修改不重新抽取、不覆盖用户改动；并行会话和外部更新冲突仍受保护。
- [x] 在临时测试环境删除原会话工作区、构建缓存和 authoring 派生快照，重启并开新会话后，仍能从已安装版本恢复源码、修改和再次安装。
- [x] Builder 安装产物完整复制到另一干净测试环境并通过正常导入安装后，仍能恢复源码；不隐含原机器的缓存路径。
- [x] 旧无源码包保持可运行，迭代入口准确说明缺源码；Agent 不把重新编写的工程当作完整恢复。
- [x] HTTP Client 测试工程已移出迁移范围。
- [x] UI-only、Backend-only、UI + Backend、原生依赖和 Builder 自身使用对应验证；包体积记录在 Release 元数据，构建与测试耗时记录在 CI 日志。
- [x] README、打包器、CI、Core、Builder 对源码格式和安装/发布要求一致；新发布和 Builder 新安装没有绕过源码门禁的选项。

## 10. 验证命令与发布边界

- moss-apps：`bun run validate`、`bun test scripts`、`bun run package`；每个包在临时源码 workspace 执行 frozen install/check/test/build，最终 ZIP 校验使用 Core 同一验证器。
- 最终归档独立重建：`node scripts/verify-source-package.mjs --rebuild`，逐文件比较重新构建的运行产物。
- Core：`bun test --timeout 30000 ui/tests/app-source-package.test.mjs ui/tests/app-authoring-*.test.mjs`；受管包管理器首次下载的集成测试允许更长超时。
- Backend 握手检查使用临时数据目录、无业务授权的 Host 和 Node 文件访问限制，不允许读取原源码及开发仓库；知识库的 Python 能力返回未安装测试状态，飞书只使用配置 Schema 生成的占位值。外部连接和原生功能仍需各 App 的业务集成验证。
- 本地包记录实际源码哈希和 dirty 来源；不冒充已提交发布。`--require-signature` 拒绝未提交源码及脏 Core 子模块。签名发布由固定提交上的 release 工作流执行，不修改已有版本。

## 11. 2026-10-10 发布记录

全部版本必须先通过对应 Release 工作流，再进入应用市场；工作流链接保留构建与独立重建结果。

| 应用 | 版本 | CI |
| --- | --- | --- |
| 应用构建 | [0.1.2](https://github.com/baiguidong/moss-apps/releases/tag/moss.app-builder-v0.1.2) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38038926741) |
| 审计中心 | [0.1.6](https://github.com/baiguidong/moss-apps/releases/tag/moss.audit-v0.1.6) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38039137106) |
| 开发工具 | [0.2.4](https://github.com/baiguidong/moss-apps/releases/tag/moss.devtools-v0.2.4) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38039801953) |
| 网盘 | [0.3.4](https://github.com/baiguidong/moss-apps/releases/tag/moss.drive-v0.3.4) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38038938435) |
| 飞书 | [0.4.12](https://github.com/baiguidong/moss-apps/releases/tag/moss.feishu-v0.4.12) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38039532286) |
| 知识库 | [0.1.8](https://github.com/baiguidong/moss-apps/releases/tag/moss.library-v0.1.8) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38039536704) |
| MCP 管理 | [0.1.7](https://github.com/baiguidong/moss-apps/releases/tag/moss.mcp-v0.1.7) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38038950500) |
| 即时消息 | [0.2.12](https://github.com/baiguidong/moss-apps/releases/tag/moss.openim-v0.2.12) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38039057196) |
| 调用追踪 | [0.1.4](https://github.com/baiguidong/moss-apps/releases/tag/moss.trace-v0.1.4) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38038954853) |
| 工作流 | [0.1.15](https://github.com/baiguidong/moss-apps/releases/tag/moss.workflow-v0.1.15) | [构建记录](https://github.com/baiguidong/moss-apps/actions/runs/38038959277) |

应用市场索引：<https://baiguidong.github.io/moss-apps/v1/index.json>。所有本批版本的 `artifact.sourceIncluded` 为 `true`，格式为 v1，均提供签名 ZIP、SHA-256 和 release.json。历史版本及失败构建标签保持不变。
