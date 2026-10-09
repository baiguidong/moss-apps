# Moss App SDK

当前引用 SDK `2.8.0`。SDK 源码由 [Moss Core](https://github.com/baiguidong/moss/tree/main/packages/app-sdk) 统一维护，本仓库通过固定提交的 `vendor/moss-core` Git 子模块直接引用其 SDK workspace，仅维护接入说明和消费端回归测试。

App 可通过通用 `backend.host.request()` 使用较新 Desktop 提供的协议。MCP App 要求 Host API `^2.4.0` 的 `moss.mcp/v1`，仍可使用当前 SDK 的传输实现。仓库构建校验采用 Manifest 声明的最低 Host 版本；市场和安装阶段继续按实际运行的 Host 版本判断兼容性。无需为仅使用通用 transport 的协议复制 SDK 或更新子模块。详见 [MCP App](../apps/mcp/README.md)。

## Backend 运行契约

App Backend 只支持 Moss Desktop，运行位置无需在 Manifest 中声明。`protocols` 直接使用协议名称数组；只有客户端运行时 Backend 才可用。

App 可以通过 Host API 使用 Moss Server 提供的能力，但 App Backend 本身不会部署到 Server。本仓库 App 不得声明 `targets` 或 `serverOwnerScope`，SDK 也不提供 `moss.remote/v1`。

这里的声明限制由仓库校验器在 SDK 规范化之前执行；SDK 与 Core 一致，会忽略未知 Manifest 字段且不修改调用方的原始对象。

## 2.2 接口变化

- 新增 `@moss/app-sdk/cloud-storage`：公共云端文件、目录、配额及传输任务。
- 通用客户端能力改用 `@moss/app-sdk/platform`、`moss.platform/v1`、`platform:*` 权限，以及 `client.platform` / `context.platform`。旧 `desktop` 导出和方法已移除，已有 App 需要同步修改调用与 Manifest。
- `identity.current` 返回 `user`、可选 `organization` 和 `scopes`，不再包含 `source`。
- `instances.getStatus()` 类型修正为单个状态对象或 `null`。
- 导出 `resolveBackendProtocols()`，`compileJsonSchema()` 支持可选的 `removeAdditional` 参数。

校验器支持 `^2.0.0`、`^2.1.0` 和 `^2.2.0` 的版本范围。依赖云端存储或本次迁移后的 Platform 协议时，App 应声明 `hostApi: "^2.2.0"`，避免安装到本仓库先前使用的旧宿主。

## 云端存储接入

最小 Manifest：

```json
{
  "schemaVersion": 2,
  "id": "example.drive",
  "version": "0.1.0",
  "displayName": "网盘",
  "hostApi": "^2.2.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "protocols": ["moss.cloud-storage/v1"],
    "actions": [
      { "name": "files.list" },
      { "name": "files.upload" },
      { "name": "files.download" },
      { "name": "transfers.list" }
    ]
  },
  "permissions": ["cloud-storage:read", "cloud-storage:write"]
}
```

Backend 使用受控文件句柄创建异步任务；文件字节由 Host 传输：

```js
import { AppBackendClient } from '@moss/app-sdk'
import { createCloudStorageClient, CLOUD_STORAGE_EVENTS } from '@moss/app-sdk/cloud-storage'

const backend = new AppBackendClient()
const cloud = createCloudStorageClient(backend.host)
for (const name of CLOUD_STORAGE_EVENTS) {
  cloud.on(name, data => backend.emit('cloud.event', { name, data }))
}
backend.start({
  'files.list': input => cloud.request('files.list', input ?? {}),
  'files.upload': async (input = {}) => {
    const { files } = await cloud.request('local-files.pick')
    const transfers = []
    for (const file of files) {
      transfers.push(await cloud.request('uploads.start', {
        handle: file.handle,
        parentId: input.parentId ?? null,
      }))
    }
    return { transfers }
  },
  'files.download': input => cloud.request('downloads.start', { fileId: input.fileId }),
  'transfers.list': input => cloud.request('transfers.list', input ?? {}),
})
```

UI 调用已声明的 `mossApp.actions.invoke(instanceId, action, input)`，订阅 `mossApp.events.on('cloud.event', callback)` 显示进度，并在重新打开页面时查询任务恢复显示。实际 App 还需按创建规范补齐 UI、publisher、marketplace 信息、输入/输出 Schema 与状态处理。

上传、下载的返回值是任务 ID，不代表文件已经传完。任务通过 `transfers.get/list` 和 `transfers.progress/changed` 事件查询；暂停、恢复、取消使用 `transfers.pause/resume/cancel`。上传失败会进入 `paused` 并返回 `error`，不能只根据状态名判断是否出错。

`status.get` 用于检查云端可用状态。使用前需要开启 Moss 远程连接、登录启用了云端存储的 Server，并具有相应授权。同目录同名上传会返回冲突，下载不会覆盖已有文件。关闭页面可继续传输，退出 Moss 后暂停，重启后需要显式恢复。

完整方法、状态和部署前提见 [Core 云端存储文档](https://github.com/baiguidong/moss/blob/main/docs/cloud-storage.md)。本仓库消费端回归随 `bun run test` 运行。

## 2.3 分享接口

新增 `CloudShare`、`shares.create/list/revoke` 与 `cloud-storage:share`。网盘要求 `hostApi: ^2.3.0`，接收页由 Server 的 `/s/:token` 提供；浏览器不依赖 Desktop Host。详见 [分享实施方案](drive-sharing-plan.md) 及 Core 云端存储文档。

Trace App 通过通用 `backend.host.request()` 使用 Host API `^2.5.0` 的 `moss.trace/v1` 协议。构建按 App 声明的最低 Host 版本校验；市场和安装时仍检查实际 Host 版本。参见 [Trace App](../apps/trace/README.md)。

审计中心使用 Host API `^2.6.0` 的 `moss.audit/v1` 协议。App 自己维护规则引擎、SQLite 和扫描；Host 只导出脱敏会话、迁移旧库、保留撤销事件、定位会话和投递通知。固定的 Core 提交也用于最终签名 ZIP 的集成验证，避免依赖开发者的相邻工作区。参见 [审计中心](../apps/audit/README.md)。


## 2.8 Workflow App 与会话资源

Workflow 使用通用 `moss.agent-execution/v1` 执行接口与 `moss.tasks/v1`、App 任务、`resourceProviders.listAction` 和 `composer.prepare`。Core 不包含 Workflow 引擎；定义、画布和调度位于 `apps/workflow`。

Workflow 固定使用 `vendor/moss-core` 中 Core 提交 `570209f8a0175216e94502d8737e0d93183d91a8` 的 SDK/Runtime 2.8。执行 `git submodule update --init --recursive` 后即可安装和构建，无需额外 SDK 补丁。
