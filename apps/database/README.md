# 数据库查询

`moss.database@0.2.1` 在 App 页面中动态管理数据库连接，无需手写 TOML 或修改启动参数。数据库工具由固定版本 `@bytebase/dbhub@1.5.0` 提供，需要 Moss Host API >=3.9 和 Node >=22.5。

## 使用

1. 打开「设置 → Apps → 数据库查询」，点击「添加连接」。
2. PostgreSQL、MySQL、MariaDB 填写主机、端口、数据库、用户名和密码；SQLite 填写已有数据库文件的绝对路径。「自定义连接地址」支持 SQL Server、Oracle，以及需要 SSL 等额外参数的连接。
3. 设置只读权限、最多返回行数和查询超时，点击「保存并测试」。首次连接需要下载运行依赖。
4. 在会话中选择数据库查询 App 后，即可查看表结构和执行查询。可添加多个连接，随时编辑、停用或删除。

密码和完整连接地址由 Moss Credential Vault 加密保存，不回显。编辑时密码或连接地址留空保留旧值；勾选「清除已保存的密码」可改为无密码连接。切换数据库类型时需填写新类型的连接信息。非敏感配置保存在 App 数据目录，TOML 由 App 自动生成，每次保存使用新文件，失败时保留原连接。

默认只读、最多返回 1000 行、查询超时 10 秒。SQLite 驱动不使用查询超时选项。只读限制作用于查询工具，最终权限仍由数据库账号控制。SQLite 只接受已有且具有正确文件头的数据库，不会用占位路径创建空库。删除连接只删除注册和凭据，不删除用户数据库。

旧版的已配置连接会保留。默认 `~/moss-database.toml` 不存在时，打开页面会停用该无效连接；点击编辑填写信息后，App 生成自己的配置并恢复连接。已有外部 TOML 文件不修改，复杂多源配置可继续通过通用设置管理。

## 验证与打包

在仓库根目录执行：

```sh
bun run --cwd apps/database check
bun run --cwd apps/database test
node scripts/package-app.mjs --app moss.database
node apps/database/scripts/verify-ui.mjs
node apps/database/scripts/verify-layout.mjs
```

`verify-ui.mjs` 需要完整 Core checkout（默认 `../moss`，可设置 `MOSS_CORE_ROOT`）、已构建的 `ui/electron-direct.mjs` 和 Chrome。它使用临时 App profile、真实 Backend/Core 凭据库、DBHub 和 SQLite；浏览器页面操作覆盖添加、验证、重启恢复、编辑、启停、删除、密码不回显及浅色/深色/窄屏布局。不会连接个人或生产数据库。`verify-layout.mjs` 使用模拟桥接验证深浅色、窄屏与较矮面板中的滚动区、按钮和错误提示，无需数据库。其他数据库驱动的连接地址生成和凭据更新由单元测试覆盖。

ZIP、源码快照与验证截图位于 `artifacts/moss.database/0.2.1/`。目前市场仅声明已验证的 macOS Apple Silicon。

上游：[DBHub](https://github.com/bytebase/dbhub)，[MIT 许可证](assets/licenses/dbhub-LICENSE.txt)。
