# 迁移 App 问题分诊（2026-10-19）

## 需要决定保留还是删除

| App | 当前证据 | 修复判断 |
| --- | --- | --- |
| `moss.tiktok` · TikTok for Business | 本机 MCP 请求 `fetch failed`，直接访问端点超时，未取得认证 URL | 本地包安装正常；需网络路由或服务端恢复，当前无法从 App 包内修好。若业务不用，可删除。 |

## 可以修复或继续认证

| App | 情况 | 下一步 |
| --- | --- | --- |
| `moss.wecom` · 企业微信 | CLI 显示 `authorized`，真实只读查询返回错误码 850003（授权过期） | 在已打开的认证入口重新授权，再重试只读查询。 |
| `moss.ai-hive` · AI-HIVE | MCP 进程提示尚未连接；CLI 认证页已打开 | 登录或在服务网页生成 API Key。缺认证不代表包损坏。 |
| `moss.ragflow` · RAGFlow | 隔离探测缺少 Moss 会话令牌；实际发送的 Header 仍有 `${MOSS_SERVER_AUTH_TOKEN}` 占位符 | 在带 Moss 登录态的会话中重试，或配置 RAGFlow API Key。当前 401/404 不能证明包故障。 |
| `moss.ioa` · iOA | MCP 工具可列，身份查询要求设备码登录；认证页已打开 | 完成设备码登录后重试。 |
| `moss.flova` · Flova | 已取得授权 URL；无头 Chrome 等待 30 秒未返回 DOM | 系统 Chrome 已接收打开命令，需确认交互式页面是否正常显示。 |
| `moss.kling-ai-plugin-ai` · Kling AI 海外版 | 同上 | 同上。 |
| `moss.notion` · Notion | 同上 | 同上。 |
| `moss.fbs-connector` · 福帮手 | 首轮 12 秒 MCP 探测超时；30 秒重测列出 11 个工具，`skill_whoami` 只读调用成功 | 已通过，无需删除。 |

## 需要填入凭据的 26 个 MCP App

以下项目的本地包和权限检查已通过，但没有足够的服务配置来启动 MCP；这属于待配置，不是已确认故障。若业务不用，可从这组中挑选删除。

| App ID | 服务 |
| --- | --- |
| `moss.bugly-token` | Bugly 质量概览 |
| `moss.cisp-mcp` | 水滴征信 |
| `moss.dcs-cloud` | DCS Cloud |
| `moss.fazhi-law` | 同花顺法律AI助手 |
| `moss.fuma-ai-callout` | 福马AI外呼任务 |
| `moss.gangtise-mcp` | Gangtise投研 |
| `moss.gildata` | 恒生聚源 MCP |
| `moss.h3c-cloudnet` | 新华三Cloudnet灵犀AI助手 |
| `moss.h3yun-connector` | 氚云 |
| `moss.infimind-ecommerce-image` | 极睿电商生图 |
| `moss.infimind-video` | 极睿视频 |
| `moss.kuaicha-search` | 同花顺快查企业数据 |
| `moss.lingxing-mcp` | 领星ERP |
| `moss.linkfox-product-selection` | Linkfox 选品 |
| `moss.opendata` | 及刻智能·时空数据MCP |
| `moss.patsnap-search` | 智慧芽专利&文献融合检索 |
| `moss.picset-commerce-images` | Picset AI 电商图片 |
| `moss.picset-video-generation` | Picset AI 视频创作 |
| `moss.sq-company-dynamic` | 上奇产业通-企业动态追踪 |
| `moss.tencent-map` | 腾讯地图 |
| `moss.tushare` | Tushare |
| `moss.weisheng-scrm` | 微盛企微管家SCRM |
| `moss.wind-finance` | Wind 金融数据 |
| `moss.yingmi-mcp` | 盈米MCP |
| `moss.youshu-bd-mate` | 智客AI · 对公(To B)营销助手 |
| `moss.zfs-fssc-ai` | 中兴新云AI智报 |

腾讯自选股已按用户选择从仓库、本地产物和本机安装中删除。

另外，48 个 MCP 端点返回“需要账号授权”，29 个 CLI App 的登录入口已打开；根据本次验收口径，这些未登录状态不列为 App 故障。剩余 114 项状态见 [逐项验收](connector-apps-local-verification.md)。

本机测试使用 Host API 3.15.0 源码运行时；`/Applications/Moss.app` 仍为 0.0.8，GUI 尚未验收。
