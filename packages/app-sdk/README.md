# Moss App SDK

当前 SDK 对应 Host API `2.1.0`。2.1 新增 Desktop-only 的 `moss.openim/v1` 管理协议，兼容要求 `^2.0.0` 的 App。

## Backend 运行契约

App Backend 只支持 Moss Desktop，运行位置无需在 Manifest 中声明。`protocols` 直接使用协议名称数组；只有客户端运行时 Backend 才可用。

App 可以通过 Host API 使用 Moss Server 提供的能力，但 App Backend 本身不会部署到 Server。Manifest 不接受 `targets` 或 `serverOwnerScope`，SDK 也不提供 `moss.remote/v1`。
