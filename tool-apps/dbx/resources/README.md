# DBX MCP

独立配置型 MCP App，复用 Moss 内置设置页。原版 `@dbx-app/mcp-server@0.4.127` 启动器和六个平台 Rust 二进制全部随包分发，使用 stdio；运行时不执行 npx，不需要安装 Rust。

在会话中选择 DBX MCP 后使用。Moss 设置提供服务开关、工具范围、排除工具和连接配置；数据库连接、凭据及数据库权限仍由 DBX 管理，在 DBX「设置 → MCP」配置。该 App 不包含 DBX 完整客户端。

默认读取本机 DBX 数据，可通过连接配置的 env 设置 `DBX_DATA_DIR`，或用 `DBX_WEB_URL` / `DBX_WEB_PASSWORD` 访问已有 DBX Web。没有配置连接或缺少凭据密钥时，服务启动不等于数据库可用。`KEY_PROVIDER_UNAVAILABLE` 需要恢复 DBX 的凭据密钥，不要为已有加密数据随意换钥。

macOS、Windows 和 Linux（glibc）ARM64/x64 均有随包二进制；Agent/JDBC 等功能仍需要上游额外组件。图标及服务来自 https://github.com/t8y2/dbx ，许可证见 `assets/licenses/dbx-LICENSE.txt`。

Linux 需要 glibc >=2.30，不支持 Alpine/musl。Windows 10/11 使用系统 UCRT，随包原始 Microsoft VC Runtime DLL 遵循独立许可，详见 `runtime/native/LICENSE.txt` 与来源记录；发布者需确认 Microsoft REDIST 授权。
