# 渠道 App 规划

飞书是第一个渠道 App。后续根据 MossWork 实际可配置的渠道逐个增加独立 App，每个 App 使用自己的凭据、连接生命周期和 Moss 会话绑定。

| 顺序 | 渠道 | MossWork 配置方式 |
| --- | --- | --- |
| 1 | 飞书 | 扫码创建应用、手动填写 |
| 2 | 微信、QQ、企业微信、钉钉 | 微信沿用扫码，其他渠道沿用各自的扫码与手动填写 |
| 3 | Telegram、Discord、小艺、MQTT | 复用各自的凭据与连接设置 |

范围对照 MossWork Dashboard 的 `CHANNEL_KEYS` 和 `moss-gateway` 的 `ChannelKind`，排除元宝。每种渠道先搬用 MossWork 的配置流程和消息处理源码，再通过 Moss App SDK 对接凭据库、内置运行时和会话。第二个渠道落地时再提取两者已经共用的 Python 启动逻辑和 UI 样式。

渠道可通过 `moss.agent/v1` 的 `turn.start` 为本轮开启 `progress.thinking` 和 `progress.tools`。宿主将思考状态及工具名称和调用状态通过 `turn.progress` 发给请求的 App 实例。飞书在「处理提示和最终回复」模式下提供两个独立开关。

渠道统一使用市场主分类 `channel`，中文名「渠道」。当前固定的 Moss Core SDK Manifest Schema 尚无该分类，飞书发布包暂用现有 `communication`。分类契约已整理成 [Core 补丁](patches/moss-core-channel-category.patch)。补丁允许支持新分类的 Host 把现有飞书包显示在「渠道」，并为新 Manifest 的 `channel` 声明设置 Host API 3.25 门槛。发布新版 Host 后更新本仓库固定的 SDK，随后在新包中使用 `channel`。
