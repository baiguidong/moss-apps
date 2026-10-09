# 审计中心

`moss.audit@0.1.1`，需要 Host API `^2.6.0` 的 Moss Desktop。

查看本地会话、工具调用、风险发现、操作事件和审计记录，配置规则并批量处理发现项。保留原有七类规则、子 Agent 工具归属去重、增量扫描、严重发现通知，以及跳转会话和定位工具调用。此版本不审计远程会话，不注册 AI 工具。

安装后默认启用，后台在客户端运行期间每 30 秒扫描一次；关闭 App 页面不停止扫描。停用或卸载后停止读取会话与记录新的撤销事件。重新启用会扫描当前仍存在的本地会话；停用期间已被撤销的历史不会补录。未安装 App 不阻止 Moss 的会话撤销操作。

## 数据与迁移

数据保存在 `<MOSS_HOME>/apps-data/moss.audit/instances/moss.audit--default/`：

- `audit.db`：规则、扫描结果、发现项处理状态、审计记录、归档事件。
- `source/snapshot.json`：Host 原子写入的脱敏本地会话快照，不通过 IPC 传输正文。
- `events/`：Host 写入的撤销事件，App 幂等导入数据库。
- `legacy-import-v1.json`：一次性迁移记录。

首次读取数据前，Host 使用 SQLite 在线备份复制旧 `<MOSS_HOME>/audit.db`，包含 WAL 中尚未合并的数据。旧数据库保留；后续启动不会覆盖 App 内的修改。若迁移失败，显示错误并允许重试。卸载按 Moss 的保留／删除 App 数据选项处理。

## Host 权限

`moss.audit/v1` 提供三个受控方法：

| 方法 | 权限 | 作用 |
| --- | --- | --- |
| `source.capture({})` | `audit:read` | 将脱敏本地会话快照写入当前 App 私有目录，返回版本、时间和数量 |
| `session.open({sessionId,toolUseId?})` | `audit:navigate` | 打开仍存在的本地会话，可定位工具调用 |
| `notification.publish({id,severity,title,message,details?})` | `audit:notify` | 通过宿主通知中心幂等投递通知 |

Host 验证 App 身份、声明、授权、实例和进程代际；不接受调用方指定存储目录。App 自己拥有规则、SQLite 查询、扫描与通知策略，不导入 Moss 内部模块。

## 开发与本地交付

在 `moss-apps` 根目录执行 `bun install` 后：

```sh
bun run --cwd apps/audit check
bun run --cwd apps/audit test
bun run --cwd apps/audit build
bun run package -- --app moss.audit --skip-build
bun run --cwd apps/audit test:integration
bun run --cwd apps/audit test:browser
```

集成验证默认使用固定在 `vendor/moss-core` 的真实 Host 与实际 ZIP，可通过 `MOSS_CORE_ROOT` 指定其他 Core 检出。浏览器验证使用真实 SQLite 服务，覆盖主要页面与交互。验证用临时目录，不读写用户会话。ZIP 位于 `artifacts/moss.audit/0.1.1/`。正式版本由 `moss.audit-v0.1.1` 标签触发签名发布，签名后的 ZIP 也必须通过集成验证才能上传。
