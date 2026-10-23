# 连接器 App 交付

在已有 App 及市场卡片的基础上新增 114 个服务 App。既有 App 的源码、ID、安装状态与数据不因本次连接器接入而迁移。

## 源码与安装

- 源码：`tool-apps/<服务名>/`，维护 `app.json`、`marketplace.json` 与可选技能、资源；共享生成器导出可重建工程，不维护逐工具 Manifest、package.json 或构建脚本。
- 命名：App ID 为 `moss.<服务名>`，不增加 `connector` 前缀。飞书 CLI 使用 `tool-apps/feishu-cli/`、`moss.feishu-cli`，已有 `apps/feishu/` 与 `moss.feishu` 保持不变。
- 身份：App ID 与服务元数据 ID 独立，生成后的 `connectorApp.id` 显式关联 `app.json` 中 `connector.id`；不拼接或解析 App ID 前缀。原 MCP、CLI、技能载荷和 `connector:use` 权限保持不变。
- 打包：使用已有 `scripts/package-app.mjs`，交付签名 ZIP、完整源码、checksum 和 release 元数据。
- 运行：Moss Host 提供账号管理、MCP、CLI 与技能支持；服务包不伪造独立 UI 或 Backend。
- 安装：只通过 moss-apps 应用市场或显式导入安装包；Moss 不扫描旧连接器进行安装，不转移旧会话选择。
- 用户数据：此次只迁移源码，不迁移旧连接器数据。已经正常安装的普通 App 继续使用原安装。

## 展示

市场与已安装页使用“全部 / 应用 / 工具”分区，工具支持 MCP / CLI / Skills 能力筛选，本地 / 在线作为独立筛选与标签。现有安装身份及历史发布产物保持不变，不增加隐藏应用功能。见 [应用与工具组织规范](tool-app-organization.md)。

认证单独标注浏览器、API Key、账号密码或 Moss 账号；未知认证方式保持待确认。CLI 是否在本机运行不决定其业务属于本地还是在线。

## 发布前提与验证

这批新增 App 要求 Host API 3.15.0。Core 的 SDK、Connector App 校验和源码重建支持需要先提交并固定到 vendor/moss-core。遵循现有签名发布门禁：已提交 App 源码、干净且已推送的 Core 子模块。不得把本地未签名测试 ZIP 当作线上发布。

当前保留 114 个已完成构建和源码随包校验的服务包；另外运行 MCP、CLI+技能、纯技能代表包的独立源码重建。原有 26 个线上卡片加上 114 个新卡片，发布前市场预览应为 140 个。线上发布状态以 GitHub Releases/Pages 为准，本地生成不代表已发布。

## 服务目录

| App | 能力 | 认证 | 源码 |
| --- | --- | --- | --- |
| 铱云AI供应链 | cli, skills | browser | [目录](../tool-apps/77ircloud) |
| AI-HIVE | mcp, cli, skills | browser | [目录](../tool-apps/ai-hive) |
| 向日葵远程控制 | cli, skills | browser | [目录](../tool-apps/awesun) |
| 百度网盘 | mcp, skills | browser | [目录](../tool-apps/baidu-netdisk) |
| 八爪鱼 | mcp, skills | 待确认 | [目录](../tool-apps/bazhuayu) |
| 北森AI · HR专家 | cli, skills | browser | [目录](../tool-apps/beisen-cli) |
| Bugly 质量概览 | mcp, skills | api-key | [目录](../tool-apps/bugly-token) |
| 扫描全能王 | mcp, skills | 待确认 | [目录](../tool-apps/camscanner-mcp) |
| Canva可画（中国） | mcp, skills | 待确认 | [目录](../tool-apps/canva) |
| Canva可画（海外） | mcp, skills | 待确认 | [目录](../tool-apps/canva-ai) |
| 水滴征信 | mcp, skills | api-key | [目录](../tool-apps/cisp-mcp) |
| 腾讯云 CloudBase | mcp, cli, skills | browser | [目录](../tool-apps/cloudbase) |
| CNB | cli, skills | browser | [目录](../tool-apps/cnb-api) |
| 携程问道 | skills | api-key | [目录](../tool-apps/ctrip-wendao) |
| DCS Cloud | mcp, skills | api-key | [目录](../tool-apps/dcs-cloud) |
| 美图设计室 AI设计 CLI | cli, skills | browser | [目录](../tool-apps/designkit-buddy-cli) |
| 钉钉 | cli, skills | browser | [目录](../tool-apps/dingtalk) |
| 深知可信工作台 | mcp, skills | 待确认 | [目录](../tool-apps/dknowc-mcp) |
| 夺冠蜂巢 | mcp, skills | 待确认 | [目录](../tool-apps/duoguan-fengchao) |
| EdgeOne Makers | mcp, skills | 待确认 | [目录](../tool-apps/edgeone-pages) |
| 弹性MapReduce | cli, skills | browser | [目录](../tool-apps/emr-query) |
| EzyJoin智慧会议 | mcp, skills | 待确认 | [目录](../tool-apps/ezjoin-meeting) |
| 同花顺法律AI助手 | mcp, skills | api-key | [目录](../tool-apps/fazhi-law) |
| 福帮手 | mcp, skills | none | [目录](../tool-apps/fbs-connector) |
| 飞书工具 | cli, skills | browser | [目录](../tool-apps/feishu-cli) |
| 粉笔 | mcp, skills | 待确认 | [目录](../tool-apps/fenbi-baokao-decision) |
| 进门投研 | mcp, skills | 待确认 | [目录](../tool-apps/finenter) |
| Flova | mcp, skills | browser | [目录](../tool-apps/flova) |
| 福马AI外呼任务 | mcp, skills | api-key | [目录](../tool-apps/fuma-ai-callout) |
| 法研·法律法规检索 | mcp, skills | 待确认 | [目录](../tool-apps/fyopen-lawsearch) |
| Gangtise投研 | mcp, skills | api-key | [目录](../tool-apps/gangtise-mcp) |
| 高顿•实习就业助手 | mcp, skills | 待确认 | [目录](../tool-apps/gaodun-job) |
| 恒生聚源 MCP | mcp, skills | api-key | [目录](../tool-apps/gildata) |
| 新华三Cloudnet灵犀AI助手 | mcp, skills | api-key | [目录](../tool-apps/h3c-cloudnet) |
| 氚云 | mcp, skills | api-key | [目录](../tool-apps/h3yun-connector) |
| i人事AI·HR专家 | cli, skills | browser | [目录](../tool-apps/ihr-cli) |
| 极睿电商生图 | mcp, skills | api-key | [目录](../tool-apps/infimind-ecommerce-image) |
| 极睿视频 | mcp, skills | api-key | [目录](../tool-apps/infimind-video) |
| 零信任安全 iOA | mcp, cli | browser | [目录](../tool-apps/ioa) |
| 金数据 | mcp, skills | 待确认 | [目录](../tool-apps/jinshuju) |
| 九数云BI | mcp | 待确认 | [目录](../tool-apps/jiushuyun) |
| Kling AI（中国） | mcp, skills | 待确认 | [目录](../tool-apps/kling-ai-plugin) |
| Kling AI（海外） | mcp, skills | 待确认 | [目录](../tool-apps/kling-ai-plugin-ai) |
| 同花顺快查企业数据 | mcp, skills | api-key | [目录](../tool-apps/kuaicha-search) |
| LemonClaw | cli, skills | browser | [目录](../tool-apps/lemonclaw) |
| 乐享知识库 | mcp, skills | 待确认 | [目录](../tool-apps/lexiang) |
| Linear | mcp | 待确认 | [目录](../tool-apps/linear-mcp) |
| 领星ERP | mcp, skills | api-key | [目录](../tool-apps/lingxing-mcp) |
| Linkfox 选品 | mcp, skills | api-key | [目录](../tool-apps/linkfox-product-selection) |
| Lovrabet CLI | cli, skills | browser | [目录](../tool-apps/lovrabet-cli) |
| MasterGo 莫高设计 | mcp, skills | 待确认 | [目录](../tool-apps/mastergo-vibe-mcp) |
| 芒果灵创 CLI | cli, skills | browser | [目录](../tool-apps/mglc) |
| 秒哒应用搭建 | cli, skills | browser | [目录](../tool-apps/miaoda) |
| Moka HR 智能体 | mcp, skills | 待确认 | [目录](../tool-apps/moka) |
| 晨星 Morningstar | mcp, skills | 待确认 | [目录](../tool-apps/morningstar) |
| 东方财富妙想MCP | mcp, skills | 待确认 | [目录](../tool-apps/mx-ds-mcp) |
| 摩知轮商标查询 | mcp, skills | 待确认 | [目录](../tool-apps/mzl-trademark) |
| 销售易CRM | mcp, skills | 待确认 | [目录](../tool-apps/neo-crm) |
| 网易邮箱 | skills | credentials | [目录](../tool-apps/netease-mail) |
| Notion | mcp, skills | 待确认 | [目录](../tool-apps/notion) |
| 及刻智能·时空数据MCP | mcp, skills | api-key | [目录](../tool-apps/opendata) |
| PandaData 金融数据 | mcp, skills | 待确认 | [目录](../tool-apps/pandadata) |
| 智慧芽专利&文献融合检索 | mcp, skills | api-key | [目录](../tool-apps/patsnap-search) |
| Picset AI 电商图片 | mcp, skills | api-key | [目录](../tool-apps/picset-commerce-images) |
| Picset AI 视频创作 | mcp, skills | api-key | [目录](../tool-apps/picset-video-generation) |
| 北大法宝·法律智能检索 | mcp, skills | 待确认 | [目录](../tool-apps/pkulaw) |
| OpenBoost 跨境数据 | mcp, skills | 待确认 | [目录](../tool-apps/proboost) |
| 企查查 | mcp, skills | 待确认 | [目录](../tool-apps/qcc-company) |
| 企查查·法律数据 | mcp, skills | 待确认 | [目录](../tool-apps/qcc-legal) |
| 轻流 | mcp, skills | 待确认 | [目录](../tool-apps/qingflow) |
| QQ邮箱 | mcp, skills | 待确认 | [目录](../tool-apps/qq-mail) |
| RAGFlow 企业知识库 | mcp, skills | moss-session, api-key | [目录](../tool-apps/ragflow) |
| 致远互联协同办公服务 | cli, skills | 待确认 | [目录](../tool-apps/seeyon-office-marketing-suite) |
| 用友智能服务（AI BaaS） | mcp, skills | 待确认 | [目录](../tool-apps/shanglv-mcp-gateway) |
| 商龙经营洞察 | cli, skills | browser | [目录](../tool-apps/shanlong-claw) |
| 纷享销客CRM | mcp, skills | 待确认 | [目录](../tool-apps/sharecrm) |
| ShareOne | skills | api-key | [目录](../tool-apps/shareone) |
| 上奇产业通-企业动态追踪 | mcp, skills | api-key | [目录](../tool-apps/sq-company-dynamic) |
| TDC 文化智能体 | mcp, skills | 待确认 | [目录](../tool-apps/tanyuan-assistant) |
| TAPD | mcp, skills | 待确认 | [目录](../tool-apps/tapd) |
| 同程程心 | cli, skills | browser | [目录](../tool-apps/tc-chengxin) |
| Tec-Do 2.0 广告与增长情报 | mcp, skills | 待确认 | [目录](../tool-apps/tec-do) |
| 腾讯文档 | mcp | 待确认 | [目录](../tool-apps/tencent-docs) |
| 腾讯文档企业版 | mcp | 待确认 | [目录](../tool-apps/tencent-docs-oa) |
| 腾讯健康NGES | mcp, skills | 待确认 | [目录](../tool-apps/tencent-health-nges) |
| 腾讯地图 | mcp | api-key | [目录](../tool-apps/tencent-map) |
| 微云 | mcp, skills | 待确认 | [目录](../tool-apps/tencent-weiyun) |
| 腾讯营销投放 | cli, skills | browser | [目录](../tool-apps/tencentads) |
| TextIn xParse·智能文档解析 | cli, skills | browser | [目录](../tool-apps/textin-xparse) |
| TextIn xParse·智能文档解析 | cli, skills | browser | [目录](../tool-apps/textin-xparse-ai) |
| TikTok for Business | mcp | 待确认 | [目录](../tool-apps/tiktok) |
| 腾讯会议 | cli, skills | browser | [目录](../tool-apps/tmeet) |
| 同舟金融研究 | mcp, skills | 待确认 | [目录](../tool-apps/tongzhou-fin-research) |
| 畅捷通T+ | mcp, skills | 待确认 | [目录](../tool-apps/tplus-api) |
| Tushare | mcp, skills | api-key | [目录](../tool-apps/tushare) |
| 天眼查 | mcp, skills | 待确认 | [目录](../tool-apps/tyc-mcp) |
| UU跑腿 | cli, skills | browser | [目录](../tool-apps/uupt) |
| 企业微信 | cli, skills | browser | [目录](../tool-apps/wecom) |
| 微盛企微管家SCRM | mcp, skills | api-key | [目录](../tool-apps/weisheng-scrm) |
| Wind 金融数据 | mcp, skills | api-key | [目录](../tool-apps/wind-finance) |
| 百智WiseNote | mcp, skills | 待确认 | [目录](../tool-apps/wisenote) |
| 威科先行 | mcp, skills | 待确认 | [目录](../tool-apps/wk-workbuddy) |
| 微盟 WOS CLI | cli, skills | browser | [目录](../tool-apps/woscli) |
| WPS知识库 | cli, skills | browser | [目录](../tool-apps/wps-knowledgebase) |
| 小鹅通 | mcp, skills | 待确认 | [目录](../tool-apps/xiaoe-cloud-cli) |
| 天创信用星图MCP | mcp, skills | 待确认 | [目录](../tool-apps/xingtu-claw-risk) |
| 盈米MCP | mcp, skills | api-key | [目录](../tool-apps/yingmi-mcp) |
| 智客AI · 对公(To B)营销助手 | mcp, skills | api-key | [目录](../tool-apps/youshu-bd-mate) |
| 华宇元典法律数据 | mcp | 待确认 | [目录](../tool-apps/yuandian-mcp) |
| 云客AI工作手机 | cli, skills | browser | [目录](../tool-apps/yunke-cli) |
| 云帐房AI财税 | mcp | 待确认 | [目录](../tool-apps/yzf-general-mcp-server) |
| 云帐房AI开票 | mcp, skills | 待确认 | [目录](../tool-apps/yzf-invoice-mcp-server) |
| 中兴新云AI智报 | mcp, skills | credentials | [目录](../tool-apps/zfs-fssc-ai) |
| 知识星球 | cli, skills | browser | [目录](../tool-apps/zsxq) |
