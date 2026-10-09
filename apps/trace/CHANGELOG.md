# 0.1.0

## 0.1.2

- Host 协议统一声明在 `host.protocols`，供 UI 和 Backend 共用。
- 使用 SDK 公共大结果传输与有类型的 Trace Host 契约。

## 0.1.1

- 适配 Host API 3：使用绑定当前 App 的 SDK，统一调用取消及错误处理。

- 从 Moss Desktop 抽取本地 Trace 为独立 App。
- 启用 App 自动采集，停用或卸载停止采集，无独立采集开关。
- Core 写入 App 数据目录；App 管理索引、列表、搜索、详情和删除。
- 支持完整提示词、请求响应、工具时间线、异常诊断、大记录分块读取及主题同步。
- 首次启用导入旧本地记录，保留源文件。
- 需要 Moss Desktop Host API 2.5.0 或更高的兼容版本。
