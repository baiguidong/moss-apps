# 连接器 App 交付

在已有 App 及市场卡片的基础上新增 114 个服务 App。既有 App 的源码、ID、安装状态与数据不因本次连接器接入而迁移。

## 源码与安装

- 源码：`apps/<服务名>/`，标准 `app.moss.json`、`marketplace.json` 与可重建工程。
- 命名：App ID 为 `moss.<服务名>`，工作区包名为 `@moss/<服务名>`，不增加 `connector` 前缀。新增飞书 CLI 使用 `apps/feishu-cli/`、`moss.feishu-cli`，已有 `apps/feishu/` 与 `moss.feishu` 保持不变。
- 身份：App ID 与服务元数据 ID 独立，通过 `connectorApp.id` 显式关联 `connector/connector.json` 的 `id`；不再拼接或解析 App ID 前缀。原 MCP、CLI、技能载荷和 `connector:use` 权限保持不变。
- 打包：使用已有 `scripts/package-app.mjs`，交付签名 ZIP、完整源码、checksum 和 release 元数据。
- 运行：Moss Host 提供账号管理、MCP、CLI 与技能支持；服务包不伪造独立 UI 或 Backend。
- 安装：只通过 moss-apps 应用市场或显式导入安装包；Moss 不扫描旧连接器进行安装，不转移旧会话选择。
- 用户数据：此次只迁移源码，不迁移旧连接器数据。已经正常安装的普通 App 继续使用原安装。

## 展示

市场增加“本地应用 / 在线服务 / 全部”，搜索与分区同排。所有原有卡片沿用原名称、说明、版本与发布产物；不增加隐藏应用功能。已安装页保持常用、本地应用和在线服务分区。

认证单独标注浏览器、API Key、账号密码或 Moss 账号；未知认证方式保持待确认。CLI 是否在本机运行不决定其业务属于本地还是在线。

## 发布前提与验证

这批新增 App 要求 Host API 3.15.0。Core 的 SDK、Connector App 校验和源码重建支持需要先提交并固定到 vendor/moss-core。遵循现有签名发布门禁：已提交 App 源码、干净且已推送的 Core 子模块。不得把本地未签名测试 ZIP 当作线上发布。

当前保留 114 个已完成构建和源码随包校验的服务包；另外运行 MCP、CLI+技能、纯技能代表包的独立源码重建。原有 26 个线上卡片加上 114 个新卡片，发布前市场预览应为 140 个。线上发布状态以 GitHub Releases/Pages 为准，本地生成不代表已发布。

## 服务目录

| App | 能力 | 认证 | 源码 |
| --- | --- | --- | --- |
| 铱云AI供应链 | cli, skills | browser | [目录](../apps/77ircloud) |
| AI-HIVE | mcp, cli, skills | browser | [目录](../apps/ai-hive) |
| 向日葵远程控制 | cli, skills | browser | [目录](../apps/awesun) |
| 百度网盘 | mcp, skills | browser | [目录](../apps/baidu-netdisk) |
| 八爪鱼 | mcp, skills | 待确认 | [目录](../apps/bazhuayu) |
| 北森AI · HR专家 | cli, skills | browser | [目录](../apps/beisen-cli) |
| Bugly 质量概览 | mcp, skills | api-key | [目录](../apps/bugly-token) |
| 扫描全能王 | mcp, skills | 待确认 | [目录](../apps/camscanner-mcp) |
| Canva可画（中国） | mcp, skills | 待确认 | [目录](../apps/canva) |
| Canva可画（海外） | mcp, skills | 待确认 | [目录](../apps/canva-ai) |
| 水滴征信 | mcp, skills | api-key | [目录](../apps/cisp-mcp) |
| 腾讯云 CloudBase | mcp, cli, skills | browser | [目录](../apps/cloudbase) |
| CNB | cli, skills | browser | [目录](../apps/cnb-api) |
| 携程问道 | skills | api-key | [目录](../apps/ctrip-wendao) |
| DCS Cloud | mcp, skills | api-key | [目录](../apps/dcs-cloud) |
| 美图设计室 AI设计 CLI | cli, skills | browser | [目录](../apps/designkit-buddy-cli) |
| 钉钉 | cli, skills | browser | [目录](../apps/dingtalk) |
| 深知可信工作台 | mcp, skills | 待确认 | [目录](../apps/dknowc-mcp) |
| 夺冠蜂巢 | mcp, skills | 待确认 | [目录](../apps/duoguan-fengchao) |
| EdgeOne Makers | mcp, skills | 待确认 | [目录](../apps/edgeone-pages) |
| 弹性MapReduce | cli, skills | browser | [目录](../apps/emr-query) |
| EzyJoin智慧会议 | mcp, skills | 待确认 | [目录](../apps/ezjoin-meeting) |
| 同花顺法律AI助手 | mcp, skills | api-key | [目录](../apps/fazhi-law) |
| 福帮手 | mcp, skills | none | [目录](../apps/fbs-connector) |
| 飞书工具 | cli, skills | browser | [目录](../apps/feishu-cli) |
| 粉笔 | mcp, skills | 待确认 | [目录](../apps/fenbi-baokao-decision) |
| 进门投研 | mcp, skills | 待确认 | [目录](../apps/finenter) |
| Flova | mcp, skills | browser | [目录](../apps/flova) |
| 福马AI外呼任务 | mcp, skills | api-key | [目录](../apps/fuma-ai-callout) |
| 法研·法律法规检索 | mcp, skills | 待确认 | [目录](../apps/fyopen-lawsearch) |
| Gangtise投研 | mcp, skills | api-key | [目录](../apps/gangtise-mcp) |
| 高顿•实习就业助手 | mcp, skills | 待确认 | [目录](../apps/gaodun-job) |
| 恒生聚源 MCP | mcp, skills | api-key | [目录](../apps/gildata) |
| 新华三Cloudnet灵犀AI助手 | mcp, skills | api-key | [目录](../apps/h3c-cloudnet) |
| 氚云 | mcp, skills | api-key | [目录](../apps/h3yun-connector) |
| i人事AI·HR专家 | cli, skills | browser | [目录](../apps/ihr-cli) |
| 极睿电商生图 | mcp, skills | api-key | [目录](../apps/infimind-ecommerce-image) |
| 极睿视频 | mcp, skills | api-key | [目录](../apps/infimind-video) |
| 零信任安全 iOA | mcp, cli | browser | [目录](../apps/ioa) |
| 金数据 | mcp, skills | 待确认 | [目录](../apps/jinshuju) |
| 九数云BI | mcp | 待确认 | [目录](../apps/jiushuyun) |
| Kling AI（中国） | mcp, skills | 待确认 | [目录](../apps/kling-ai-plugin) |
| Kling AI（海外） | mcp, skills | 待确认 | [目录](../apps/kling-ai-plugin-ai) |
| 同花顺快查企业数据 | mcp, skills | api-key | [目录](../apps/kuaicha-search) |
| LemonClaw | cli, skills | browser | [目录](../apps/lemonclaw) |
| 乐享知识库 | mcp, skills | 待确认 | [目录](../apps/lexiang) |
| Linear | mcp | 待确认 | [目录](../apps/linear-mcp) |
| 领星ERP | mcp, skills | api-key | [目录](../apps/lingxing-mcp) |
| Linkfox 选品 | mcp, skills | api-key | [目录](../apps/linkfox-product-selection) |
| Lovrabet CLI | cli, skills | browser | [目录](../apps/lovrabet-cli) |
| MasterGo 莫高设计 | mcp, skills | 待确认 | [目录](../apps/mastergo-vibe-mcp) |
| 芒果灵创 CLI | cli, skills | browser | [目录](../apps/mglc) |
| 秒哒应用搭建 | cli, skills | browser | [目录](../apps/miaoda) |
| Moka HR 智能体 | mcp, skills | 待确认 | [目录](../apps/moka) |
| 晨星 Morningstar | mcp, skills | 待确认 | [目录](../apps/morningstar) |
| 东方财富妙想MCP | mcp, skills | 待确认 | [目录](../apps/mx-ds-mcp) |
| 摩知轮商标查询 | mcp, skills | 待确认 | [目录](../apps/mzl-trademark) |
| 销售易CRM | mcp, skills | 待确认 | [目录](../apps/neo-crm) |
| 网易邮箱 | skills | credentials | [目录](../apps/netease-mail) |
| Notion | mcp, skills | 待确认 | [目录](../apps/notion) |
| 及刻智能·时空数据MCP | mcp, skills | api-key | [目录](../apps/opendata) |
| PandaData 金融数据 | mcp, skills | 待确认 | [目录](../apps/pandadata) |
| 智慧芽专利&文献融合检索 | mcp, skills | api-key | [目录](../apps/patsnap-search) |
| Picset AI 电商图片 | mcp, skills | api-key | [目录](../apps/picset-commerce-images) |
| Picset AI 视频创作 | mcp, skills | api-key | [目录](../apps/picset-video-generation) |
| 北大法宝·法律智能检索 | mcp, skills | 待确认 | [目录](../apps/pkulaw) |
| OpenBoost 跨境数据 | mcp, skills | 待确认 | [目录](../apps/proboost) |
| 企查查 | mcp, skills | 待确认 | [目录](../apps/qcc-company) |
| 企查查·法律数据 | mcp, skills | 待确认 | [目录](../apps/qcc-legal) |
| 轻流 | mcp, skills | 待确认 | [目录](../apps/qingflow) |
| QQ邮箱 | mcp, skills | 待确认 | [目录](../apps/qq-mail) |
| RAGFlow 企业知识库 | mcp, skills | moss-session, api-key | [目录](../apps/ragflow) |
| 致远互联协同办公服务 | cli, skills | 待确认 | [目录](../apps/seeyon-office-marketing-suite) |
| 用友智能服务（AI BaaS） | mcp, skills | 待确认 | [目录](../apps/shanglv-mcp-gateway) |
| 商龙经营洞察 | cli, skills | browser | [目录](../apps/shanlong-claw) |
| 纷享销客CRM | mcp, skills | 待确认 | [目录](../apps/sharecrm) |
| ShareOne | skills | api-key | [目录](../apps/shareone) |
| 上奇产业通-企业动态追踪 | mcp, skills | api-key | [目录](../apps/sq-company-dynamic) |
| TDC 文化智能体 | mcp, skills | 待确认 | [目录](../apps/tanyuan-assistant) |
| TAPD | mcp, skills | 待确认 | [目录](../apps/tapd) |
| 同程程心 | cli, skills | browser | [目录](../apps/tc-chengxin) |
| Tec-Do 2.0 广告与增长情报 | mcp, skills | 待确认 | [目录](../apps/tec-do) |
| 腾讯文档 | mcp | 待确认 | [目录](../apps/tencent-docs) |
| 腾讯文档企业版 | mcp | 待确认 | [目录](../apps/tencent-docs-oa) |
| 腾讯健康NGES | mcp, skills | 待确认 | [目录](../apps/tencent-health-nges) |
| 腾讯地图 | mcp | api-key | [目录](../apps/tencent-map) |
| 微云 | mcp, skills | 待确认 | [目录](../apps/tencent-weiyun) |
| 腾讯营销投放 | cli, skills | browser | [目录](../apps/tencentads) |
| TextIn xParse·智能文档解析 | cli, skills | browser | [目录](../apps/textin-xparse) |
| TextIn xParse·智能文档解析 | cli, skills | browser | [目录](../apps/textin-xparse-ai) |
| TikTok for Business | mcp | 待确认 | [目录](../apps/tiktok) |
| 腾讯会议 | cli, skills | browser | [目录](../apps/tmeet) |
| 同舟金融研究 | mcp, skills | 待确认 | [目录](../apps/tongzhou-fin-research) |
| 畅捷通T+ | mcp, skills | 待确认 | [目录](../apps/tplus-api) |
| Tushare | mcp, skills | api-key | [目录](../apps/tushare) |
| 天眼查 | mcp, skills | 待确认 | [目录](../apps/tyc-mcp) |
| UU跑腿 | cli, skills | browser | [目录](../apps/uupt) |
| 企业微信 | cli, skills | browser | [目录](../apps/wecom) |
| 微盛企微管家SCRM | mcp, skills | api-key | [目录](../apps/weisheng-scrm) |
| Wind 金融数据 | mcp, skills | api-key | [目录](../apps/wind-finance) |
| 百智WiseNote | mcp, skills | 待确认 | [目录](../apps/wisenote) |
| 威科先行 | mcp, skills | 待确认 | [目录](../apps/wk-workbuddy) |
| 微盟 WOS CLI | cli, skills | browser | [目录](../apps/woscli) |
| WPS知识库 | cli, skills | browser | [目录](../apps/wps-knowledgebase) |
| 小鹅通 | mcp, skills | 待确认 | [目录](../apps/xiaoe-cloud-cli) |
| 天创信用星图MCP | mcp, skills | 待确认 | [目录](../apps/xingtu-claw-risk) |
| 盈米MCP | mcp, skills | api-key | [目录](../apps/yingmi-mcp) |
| 智客AI · 对公(To B)营销助手 | mcp, skills | api-key | [目录](../apps/youshu-bd-mate) |
| 华宇元典法律数据 | mcp | 待确认 | [目录](../apps/yuandian-mcp) |
| 云客AI工作手机 | cli, skills | browser | [目录](../apps/yunke-cli) |
| 云帐房AI财税 | mcp | 待确认 | [目录](../apps/yzf-general-mcp-server) |
| 云帐房AI开票 | mcp, skills | 待确认 | [目录](../apps/yzf-invoice-mcp-server) |
| 中兴新云AI智报 | mcp, skills | credentials | [目录](../apps/zfs-fssc-ai) |
| 知识星球 | cli, skills | browser | [目录](../apps/zsxq) |
