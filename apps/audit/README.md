# 审计中心

`moss.audit@0.1.10`，需要 Host API `^3.16.0` 的 Moss Desktop。

查看本地会话、工具调用、风险发现、操作事件和审计记录，配置规则并批量处理发现项。保留原有七类规则、子 Agent 工具归属去重、增量扫描、严重发现通知，以及跳转会话和定位工具调用。此版本不审计远程会话，不注册 AI 工具。

安装后默认启用，后台在客户端运行期间每 30 秒扫描一次；关闭 App 页面不停止扫描。停用或卸载后停止读取会话与记录新的撤销事件。重新启用会扫描当前仍存在的本地会话；停用期间已被撤销的历史不会补录。未安装 App 不阻止 Moss 的会话撤销操作。

## 数据

数据保存在 `<MOSS_HOME>/apps-data/moss.audit/instances/moss.audit--default/`：

- `audit.db`：规则、扫描结果、发现项处理状态、审计记录、归档事件。
- `session-source/session-<哈希>.json`：Host 按需导出的单个脱敏会话，不通过 IPC 传输正文。
- `session-source/events/`：Host 写入的会话操作事件，App 幂等导入数据库。

审计数据库由 App 自己维护。卸载按 Moss 的保留／删除 App 数据选项处理。

## Host 权限

使用通用 Host 协议：

| 方法 | 权限 | 作用 |
| --- | --- | --- |
| `moss.session-source/v1 · session.list({})` | `session-source:read` | 返回每个本地会话的 revision、更新时间、历史长度与忙碌状态，不读取正文 |
| `moss.session-source/v1 · session.export({sessionId})` | `session-source:read` | 仅将选定会话脱敏后写入 App 私有目录 |
| `moss.session-source/v1 · session.open({sessionId,toolUseId?})` | `session-source:open` | 打开仍存在的本地会话，可定位工具调用 |
| `moss.notifications/v1 · publish({id,severity,title,message,details?})` | `notifications:publish` | 通过宿主通知中心幂等投递通知 |

Backend 每 30 秒比对 revision，只导出新增或变化的会话；删除的会话从内存索引移除。Host 验证 App 身份、声明、授权、实例和进程代际；不接受调用方指定存储目录。App 自己拥有规则、SQLite 查询、扫描与通知策略，不导入 Moss 内部模块。

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

集成验证默认使用固定在 `vendor/moss-core` 的真实 Host 与实际 ZIP，可通过 `MOSS_CORE_ROOT` 指定其他 Core 检出。浏览器验证使用真实 SQLite 服务，覆盖主要页面与交互。验证用临时目录，不读写用户会话。当前本地 ZIP 位于 `artifacts/moss.audit/0.1.10/`；正式版本须通过签名与集成验证后发布。

本版本要求 Moss Host API >=3.16.0，展示入口为“更多” → 审计中心。位置由 Manifest 声明。
