# Moss App 在线与离线交付设计

首个试点为 `moss.knowledge-rag`。0.1.12 验证本地离线介质，0.1.13 验证 CI 与应用市场交付。试点离线目标为 macOS Apple Silicon、Moss 桌面版内置 CPython 3.13。目标客户可以在外网下载一次，把完整文件带入内网，自己安装到多台同平台电脑。

## 客户如何选择

| 用户环境 | 选择 | 操作 |
| --- | --- | --- |
| 可以访问包源和模型站点 | 在线安装 | 安装普通 App ZIP，首次打开选择“在线准备”。后续从本机运行。 |
| 有 Moss，目标机器无法访问公网 | 下载对应平台的离线整包 | 在任意联网电脑下载，拷入内网，完整解压。用 Moss 的“本地安装 ZIP”安装其中的 App，再从 App 的“选择离线包”选取同目录的 `offline.json`。 |
| 目标机器尚未安装 Moss | Moss 桌面安装程序 + App 离线整包 | 在联网电脑同时取得适配目标系统的 Moss 安装程序，先安装带内置运行时的 Moss，再按上一行操作。 |

下载电脑和目标机器可以使用不同系统。下载界面可指定目标平台并显示整包大小。安装说明列出目标 Python 版本。客户准备多台机器时，可以通过 U 盘或内网文件共享分发同一份整包。

配套 Core 读取 0.1.13 的发布记录后，在市场详情页显示“在线安装”和“下载离线整包”。下载时选择目标平台和保存位置，Core 在交付文件前核对发布者签名、在线包摘要、整包长度及 SHA-256。即使下载电脑的平台不支持运行该 App，仍可代目标平台保存介质。内网机器使用本地安装入口和 App 准备页。旧版 Core 继续提供普通 App 的市场安装。试点已用仓库固定的旧 Core 解析新版索引和详情，选中的在线包摘要与新版 Core 一致。

## 版本和包的关系

两种交付共用 App ID、版本、源码、权限、MCP 工具和实例数据。针对一个目标平台，离线整包内的 App ZIP 与在线包逐字节相同。Core 用 App ID 和版本存储不可变安装内容，重复导入同一版本可以认出相同内容，已有文档和索引继续使用。

```text
moss.knowledge-rag-<version>.zip                     在线包，按原有发布和签名流程生成
moss.knowledge-rag-<version>-offline-darwin-arm64.zip
├── moss.knowledge-rag-<version>.zip                 同一份在线包
├── offline.json                                    绑定 App、版本、目标平台、Python、依赖锁和模型版本
├── wheels/                                         当前目标的全部直接和间接 Python 依赖
├── model/                                          ONNX 权重、分词器、配置和许可证
└── 安装说明.txt
```

安装时，Moss 提供基础 Python。App 在当前实例内创建 venv，离线模式限制 pip 只从本地 wheel 目录读取、只接受二进制 wheel，并逐包核对 App 内置依赖锁的哈希。模型的五个文件都按 App 内置 SHA-256 校验，校验通过才替换缓存。装好后可以移走安装介质；再次修复或在新实例安装时，可重新选取介质。

在线模式使用同一依赖锁和模型锁。默认依赖源为 PyPI，pip 配置可指定镜像。默认模型来源是 Hugging Face 上的 `Xenova/multilingual-e5-small`，量化 ONNX 导出固定在 `761b726dd34fb83930e26aab4e9ac3899aa1fa78`。模型版本随 App 发布。两种方式均可离线处理本地资料，网页导入依赖目标网页可达。

## 首个试点的实测结果

| 0.1.12 本地产物 | 压缩大小 |
| --- | ---: |
| 在线 App ZIP | 851,438 字节（831 KiB） |
| macOS ARM64 离线整包 | 214,086,141 字节（204 MiB） |

离线包约为在线包的 251 倍。已从整包解出的内层 ZIP 升级本机 Moss。独立测试实例在操作系统阻断外部连接、允许回环的条件下创建了全新 venv，安装 110 个锁定的 wheels，从介质准备模型并索引两份英文文档。以中文查询续约，语义检索首条命中英文续约文档。移走整包后重启，仍命中同一文档。

依赖检查通过，错误版本清单和缺少引擎 wheel 的资源均被拒绝。另在独立空运行时目录验证了 Moss Core 从桌面版配套本地归档安装 Python 3.13.15。桌面安装程序在裸机上的部署属于整机交付验收范围。

### 0.1.13 发布与安装演练

GitHub Actions 在 macOS 和 Linux 验证在线包，在 Apple Silicon 上构建离线整包。草稿包含两个 ZIP、各自的 SHA-256，以及含签名的发布记录。[CI 记录](https://github.com/baiguidong/moss-apps/actions/runs/44271084016)

| CI 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| 在线包 | 851,754 字节 | `55d7968efdefe091d958930284aa1f0186a30598aa1a113c49b25959858ef842` |
| macOS Apple Silicon 离线整包 | 214,086,457 字节 | `571eee6921852aea9a29eb8b141edef2fdcda2743226a98a94f890720ba8c4e6` |

Moss 桌面从演练市场读取目录，通过 GitHub Release CDN 下载上述附件。“在线安装”完成签名、权限确认和启用。另用空配置点击“在线准备”，现场下载锁定的 Python 依赖和模型，通过文件校验并完成同一项跨语言检索。在另一个新配置中，市场不可达，通过“添加应用”安装从整包解出的同一个 ZIP，再在应用里选取 `offline.json`。RAG 后端及子进程只能访问回环，新 venv 和模型准备就绪后索引两份英文资料，中文查询“客户如何续约服务”首条命中 `renewal.md`。同时验证了独立窗口正常关闭、重新打开、强制销毁及测试进程退出。[配套 Core 实现和 Electron 验收脚本](https://github.com/baiguidong/moss/tree/de5d9afe/ui)

## 发布与升级

网页操控 0.1.11 的完整包包含专用浏览器内核。支持完整 ZIP 的 Moss 可直接通过「本地安装 ZIP」安装整个离线包，首次使用专用浏览器时自动校验并准备内核。应用市场的完整包安装入口也会自动保留这些资源。

正式上线可先交付支持双包的 Core 桌面版本，再把 App 的版本更新合入 `moss-apps/main`。推送触发 **Release Changed Apps**，定时任务也会检查漏发版本。常规发布使用仓库已有的 `MOSS_APP_SIGNING_PRIVATE_KEY` 和 Core 信任的发布者公钥。正式 Release 完成后，**Publish App Catalog** 从已发布的 release JSON 构建目录和详情并部署到 GitHub Pages。Core 刷新目录后读取所选版本和目标平台的附件地址，从 GitHub Release 下载。[正式目录](https://baiguidong.github.io/moss-apps/v1/index.json)

1. 在 App 的 `marketplace.json` 声明 `offlineKitPlatforms`，值须是该 App 支持的平台。试点只启用 `darwin-arm64`。普通 App 沿用既有发布流程。
2. `Release Changed Apps` 根据版本决定是否发布，调用 `release-app.yml`。先签名并独立重建在线包，再让每个离线目标的原生 runner 下载这份精确的签名 ZIP，运行 App 的 `scripts/package-offline.py`。App 构建脚本与离线附件签名分两步执行。
3. `scripts/offline-kit.mjs` 用 Ed25519 将 App ID、版本、目标平台、发布者、密钥 ID、文件名、内外包摘要和整包大小绑定到一起。发布 job 复验签名和外包内容，并校验包内普通 ZIP 与在线附件一致。CI 将两个 ZIP、两个 SHA-256 和一份 release JSON 一起上传草稿，逐个从 GitHub 回读校验成功后才完成正式发布。
4. 市场索引和版本详情均携带可选的 `offlineKits[platform]`。普通 App 下载沿用 `artifact` 或 `artifacts[platform]`。Core 保存离线包时逐块写入临时文件，校验完成后再移动到用户指定的位置；失败会保留已有文件。市场中的目标平台选择只作用于离线下载，在线安装始终按当前宿主平台选择。
5. 客户升级时携带目标版本整包。锁相同可以复用实例 venv 和模型缓存，错误版本或错误平台会返回具体原因。实例的文档和索引由原有安装升级流程保留。若后续更换模型或维度，需要为索引设计迁移。

### 发布演练

在 GitHub Actions 的 **Release Changed Apps → Run workflow** 中选测试分支，填写 `rehearse_app=moss.knowledge-rag` 和 `rehearse_version=0.1.13`。这会执行真实构建、签名、草稿上传与回读。草稿使用独立名称，正式版本标记和公共市场继续由 main 的常规流程管理。

以下命令在仓库根目录运行。将 `RUN_ID` 设为 Actions 演练编号。桌面测试需 Apple Silicon Mac 和相邻的 Moss Core 工作区。用已构建的配套 Core renderer，或将 `VITE_DEV_SERVER_URL` 指向该工作区启动的 Vite 服务。每次测试均创建新的 Moss 配置和应用数据目录，产物和市场详情截图写入 `verification/`。

```sh
app=moss.knowledge-rag
version=0.1.13
dir="$PWD/artifacts/$app/$version"
gh release download "rehearsal-$RUN_ID-$app-v$version" --repo baiguidong/moss-apps --dir "$dir"
export MOSS_TEST_RELEASE_DIR="$dir"
export MOSS_TEST_GITHUB_DRAFT_ID="$(gh release view "rehearsal-$RUN_ID-$app-v$version" --repo baiguidong/moss-apps --json databaseId --jq .databaseId)"
../moss/ui/node_modules/.bin/electron ../moss/ui/tests/app-offline-marketplace.electron.mjs
../moss/ui/node_modules/.bin/electron ../moss/ui/tests/app-offline-marketplace.electron.mjs --offline
# 单独验证在线安装后的首次准备和跨语言检索
../moss/ui/node_modules/.bin/electron ../moss/ui/tests/app-offline-marketplace.electron.mjs --online
```

测试从 CI 的 release JSON 生成索引与详情。设置草稿 ID 后，本地测试市场会把附件请求重定向到 GitHub Release CDN，Core 自行下载，并使用内置发布者公钥校验。GitHub 登录凭据仅用于测试进程读取私有草稿。省略草稿 ID 时，测试市场直接提供下载目录中的附件，可用于重复验证。离线测试使用从市场保存的同一整包，应用市场不可达，检索后端和子进程只允许回环连接。

## 哪些 App 值得使用双包

以每个平台实测的压缩大小、首次下载量和客户网络条件决定。在线包很小、模型或原生依赖很大、核心功能能够离线完成时，增加离线整包有实际价值。本次语义知识库符合这些条件。体积接近的 App 保持单包，已经完整自带依赖的小 App 也可直接通过本地 ZIP 部署。依赖外部业务 API 的功能应明确列出需访问的内网或公网服务。

其他 App 可以复用 CI 的目标平台矩阵和 Core 的下载入口。每个 App 提供自己的离线构建和本地资源导入逻辑。venv、用户凭据、文档和索引继续按 App 实例隔离。

## 验收

- 在全新实例、空 venv、空模型和 pip 缓存下，阻断外部网络，只允许本机回环。离线准备能启动引擎、新建并索引文档、完成跨语言语义搜索。移走介质后重启可以继续检索。
- 校验整包中的 App ZIP 与在线产物摘要相同。错误平台、Python ABI、版本、损坏的模型或不完整的 wheel 集应返回可操作的错误。重复安装和取消后重试使用同一个实例。
- 每新增离线目标，在该目标的实际系统或原生 CI 上从零验证其依赖。Moss 整机首次部署单独验证桌面安装包与内置运行时能在内网就绪。
