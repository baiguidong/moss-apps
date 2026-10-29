# DBX MCP 配置型 App

独立 App ID 为 `moss.dbx`，版本 `0.1.3`，在新版 Host 中位于「插件 → 常用 → DBX MCP」（应用列表的打开入口相同）。详情页复用可视化的介绍与示例布局，直接展示缓存的工具名称、用途和搜索，并保留主动服务检查与连接设置；不再列入全局设置的 Apps。旧 Host 仍按原导航声明打开设置。由 Moss Core 原生页面根据配置展示，不加载 App UI 或 webview，不依赖「MCP 管理」App，也不搬入 DBX 完整数据库客户端 UI。

## 原版服务随包分发

对应上游配置：

```json
{
  "mcpServers": {
    "dbx": {
      "command": "npx",
      "args": ["-y", "@dbx-app/mcp-server"]
    }
  }
}
```

为避免运行时联网下载，实际使用随包的 `@dbx-app/mcp-server@0.4.127` 启动器，并显式传入 `--stdio`。Node 仅启动原版 Rust `dbx-mcp`；不重写协议或数据库业务代码，不需要本机安装 Rust/Cargo 或全局 npm 包。Moss 提供 Node 运行环境。

通用 ZIP 包含上游六个平台二进制：macOS ARM64/x64、Windows ARM64/x64、Linux ARM64/x64（glibc）。上游启动器自动选择平台。`runtime/package-lock.json` 固定下载地址、版本和完整性；所有二进制列为直接依赖，`runtime/package.json` 的 `mossBundleAllPlatforms: true` 让公共构建脚本使用 `npm ci --force --bin-links=false`，仅在构建时跨平台收集依赖并避免命令名冲突。构建禁用 npm 生命周期脚本，运行时不再安装依赖。不使用可能包含个人凭据的 `.npmrc`，源码复制仍排除此类文件。

Linux 原版二进制需要 glibc >=2.30，仅依赖 glibc 系统库；不支持 Alpine/musl 或更旧 glibc。Windows 以 Windows 10/11 的系统 UCRT 为基线，随包增加对应 ARM64/x64 的原始 Microsoft `vcruntime140.dll`，放在原版 EXE 同目录，不要求另外安装 VC Runtime。来源、校验和和单独许可见 `runtime/native/`；正式分发前发布者必须确认 Microsoft REDIST 授权。

ZIP 根据 npm `bin` 声明保留执行标记，Windows 构建也不会丢掉 macOS/Linux 二进制的执行权限；Host 解包仅授予所有者私有执行权限，需使用包含该修复的 Moss Host。Windows 构建通过 Node 直接调用 npm CLI，不借助 shell 或 `npm.cmd`，支持带空格和中文的路径。进程包含有状态数据库会话，不声明可随意空闲回收。

## 设置与权限

- Moss 内置页面：应用启停、工具范围、连接配置、检查服务和工具目录。使用范围仅在外层详情页设置。连接设置不展示服务开关、范围和排除工具控件，保存时保留既有配置。查看详情和保存参数不启动服务，实际调用或主动检查时才连接。
- DBX「设置 → MCP」：允许访问的连接、只读 / 数据读写 / 完全访问策略。Moss 排除工具不能替代 DBX 的数据库访问控制，也不会扩大 DBX 权限。
- 默认使用 DBX 的本机数据目录。连接、加密凭据和策略仍是 DBX 数据，不存入安装包，不自动迁移或生成密钥。
- 在连接配置的 `env` 中填写 `DBX_DATA_DIR` 可以改用已有数据目录。连接已有 DBX Web 时填写 `DBX_WEB_URL` 与 `DBX_WEB_PASSWORD`；这里仍是本地 stdio MCP，由上游服务访问 Web API。

MCP 服务本身不要求 DBX 桌面客户端持续运行，但本 App 不提供初始化连接、凭据和访问策略的专用页面。已有 DBX Desktop/Web 可以完成这些配置；部分 Agent/JDBC 功能仍需要上游指定的 Agent/JRE，打开 DBX 桌面表格的工具需要桌面客户端。

若新增连接返回 `KEY_PROVIDER_UNAVAILABLE`，原版 MCP 没有拿到加密密钥。它只读取密钥，不负责为新用户创建钥匙串记录；不是 stdio/HTTP 开关问题。MCP 管理在「编辑连接 → 环境变量」设置；独立 DBX MCP App 在「连接设置」的 JSON 配置 `env` 中设置 `DBX_DATA_DIR` 和 `DBX_SECRET_KEY_FILE` 的绝对路径。已有数据必须恢复原密钥；新用户使用独立空数据目录和私有随机密钥，不需要安装 DBX Desktop。

本地初始化可使用仓库 `scripts/dbx-credentials.mjs` 的 `prepareIsolatedDbxProfile()`：仅在空目录中生成 32 字节随机密钥，POSIX 目录 `0700`、密钥 `0600`，Windows 采用 Core 私有 ACL；已有密钥复用，已有数据缺少密钥则拒绝生成。返回的两个环境变量路径通过 Host 保存，密钥本身不存入安装包或源码，不自动接管 Desktop 的数据。

`DBX_MCP_ALLOW_WRITES=0` 强制只读，同时禁止添加、删除连接，不能作为「开启凭据存储」的参数。首次创建连接先不设置此限制，完成后按需设为 `0`；DBX 持久化访问策略仍有独立约束，`1` 不会绕过它。不要未经用户许可默认扩大数据库写权限。

## 构建与验证

在仓库根目录执行：

```sh
node scripts/run-apps.mjs check --app moss.dbx
bun test scripts/tool-apps.test.ts scripts/archive.test.ts scripts/npm-command.test.ts
node scripts/package-app.mjs --app moss.dbx
node scripts/verify-source-package.mjs --app moss.dbx --rebuild
node scripts/verify-dbx-mcp.mjs
node scripts/verify-dbx-host.mjs
```

`verify-dbx-mcp.mjs` 除工具发现外，实际验证新连接的凭据加密保存、重启读取和只读限制。`verify-dbx-host.mjs` 在临时 Core Profile 安装两种 App，验证环境变量传递与真实 SQLite 查询；MCP 管理的包默认使用本机已安装的当前仓库版本，可用 `MOSS_MCP_MANAGER_PACKAGE` 指定包目录。

仅当用户要求本地安装时运行 `node scripts/install-dbx-local.mjs`：安装 DBX App，为 MCP 管理中已有的 `dbx` 服务和独立 App 配置同一独立 Profile，并检查两者工具目录。不启动其他 App Backend，不改写正在运行的 Host 状态文件。安装后需重启 Moss，使其加载新增 App 和现有服务的环境变量；不自动发布市场。

输出为 `artifacts/moss.dbx/0.1.3/moss.dbx-0.1.3.zip`，包含生成配置、图标、原版服务依赖、源码和锁文件。本地包未签名；正式签名和市场发布沿用仓库发布流程，不自动替换用户安装。

图标直接来自上游 DBX，随包保留 Apache-2.0 许可证。上游源码：https://github.com/t8y2/dbx 。
