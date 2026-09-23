# Moss App SDK

当前 SDK 对应 Host API `2.0.0`。

## Backend target 契约

Manifest 必须为每个 Backend 显式声明支持的运行位置：

- `targets: ["desktop"]`：只支持 Desktop，只有客户端运行时 Backend 才可用。
- `targets: ["server"]`：只支持 Server，可由 Server 7×24 运行。
- `targets: ["desktop", "server"]`：支持在两个位置之间迁移；同一 instance 同一时刻只在一个位置 active。

`targets` 不是进程角色列表。Server 支持是 opt-in，大多数 App 只需声明 Desktop。支持两种 target 的 Backend 必须在任一位置独立运行，不能依赖另一端同时在线；两种模式的实现和适用功能可以不同。`context.target.type` 用于选择当前模式的实现。

`protocols` 按 target 声明，例如 `{"desktop": ["moss.desktop/v1"], "server": ["moss.agent/v1"]}`。Host 只向 Backend 下发当前 target 的协议列表。旧数组格式暂时兼容现有 App，并视为所有 target 共用同一列表；新 App 不应使用。

UI 与 Backend placement 独立。UI 应调用逻辑 instance，由 Host 路由到 active deployment。`moss.remote/v1` 仅为现有实现保留，新 App 不应使用它构造同时运行的 Desktop/Server Backend。
