# 114 个迁移 App 本地验收（2026-10-19）

## 结论

- 114 个 `moss.<服务名>` 包均从本地签名 ZIP 安装到 `~/.moss`，且安装授权包含 `connector:use`；仓库 `artifacts/` 顶层无 `moss.connector.*` 旧产物目录。腾讯自选股已按用户选择卸载并删除。
- 首轮 85 个 MCP 端点探测：7 个可列工具，48 个要求登录，26 个缺配置，4 个探测失败。复测后福帮手可列出 11 个工具并完成只读调用。认证入口探测取得 48 个授权 URL，其中 45 个成功由无头浏览器加载；另 3 个无头加载超时，但已由系统 Chrome 接收打开命令，未确认页面渲染。
- 29 个 CLI App 的认证入口页面均已打开。页面打开表示登录入口可达，不表示账号授权完成。
- 9 个 App 完成真实只读调用：百度网盘、腾讯云 CloudBase、携程问道、EdgeOne Makers、福帮手、MasterGo 莫高设计、ShareOne、腾讯文档、微云。
- 企业微信 CLI 状态显示 `authorized`，实际只读搜索返回 `authorization expired`；iOA 只读身份查询要求设备码登录，两者的认证入口已打开。
- 检查使用相邻 `../moss` 的 Host API 3.15.0 源码运行时；本机 `/Applications/Moss.app` 版本为 0.0.8，尚未由该桌面程序完成 GUI 验收。

## 判定口径

“已安装/已授权”仅指 Moss App 安装及 `connector:use` 权限；“认证页打开”仅指浏览器成功加载认证入口；“工具可列”说明 MCP 握手成功；“只读成功”才说明当前机器的账号可完成一项实际调用。旧的 `connected` 缓存可能过期，逐项表优先采用实时 MCP 探测和实际调用。

## 需处理的结果

- 待排查的服务端或网络问题：TikTok for Business 的 MCP 请求在本机网络失败，未取得授权 URL。
- AI-HIVE 的 stdio 进程提示本机未连接该账号，需网页生成 API Key 或完成其 CLI 认证；它的 CLI 认证页已打开。RAGFlow 的隔离探测没有 Moss 会话令牌，认证请求保留了 `${MOSS_SERVER_AUTH_TOKEN}` 占位符，需携带有效会话或 API Key 重测。福帮手使用 30 秒窗口重测后已通过。
- Flova、Kling AI 海外版、Notion 的授权 URL 均已取得并交给系统 Chrome；无头浏览器等待 30 秒仍没有取得页面 DOM，不能证明交互式页面已经渲染。
- 29 个配置表单入口涵盖 API Key、账号密码等；未填入新凭证。

## 逐项结果

| App ID | App | 能力 | 本地安装 | 认证入口 | 实时使用结果 |
| --- | --- | --- | --- | --- | --- |
| `moss.77ircloud` | 铱云AI供应链 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.ai-hive` | AI-HIVE | mcp, cli, skills | 通过 | CLI 登录页已打开 | 本机缺少该服务认证 |
| `moss.awesun` | 向日葵远程控制 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.baidu-netdisk` | 百度网盘 | mcp, skills | 通过 | 原有授权 | 只读成功：get_quota |
| `moss.bazhuayu` | 八爪鱼 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.beisen-cli` | 北森AI · HR专家 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.bugly-token` | Bugly 质量概览 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.camscanner-mcp` | 扫描全能王 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.canva` | Canva可画（中国） | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.canva-ai` | Canva可画（海外） | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.cisp-mcp` | 水滴征信 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.cloudbase` | 腾讯云 CloudBase | mcp, cli, skills | 通过 | CLI 登录页已打开 | 只读成功：auth |
| `moss.cnb-api` | CNB | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.ctrip-wendao` | 携程问道 | skills | 通过 | 配置表单 | 只读成功：技能 API |
| `moss.dcs-cloud` | DCS Cloud | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.designkit-buddy-cli` | 美图设计室 AI设计 CLI | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.dingtalk` | 钉钉 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.dknowc-mcp` | 深知可信工作台 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.duoguan-fengchao` | 夺冠蜂巢 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.edgeone-pages` | EdgeOne Makers | mcp, skills | 通过 | 原有授权 | 只读成功：account_info |
| `moss.emr-query` | 弹性MapReduce | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.ezjoin-meeting` | EzyJoin智慧会议 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.fazhi-law` | 同花顺法律AI助手 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.fbs-connector` | 福帮手 | mcp, skills | 通过 | 无需认证 | 只读成功：skill_whoami |
| `moss.feishu-cli` | 飞书工具 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.fenbi-baokao-decision` | 粉笔 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.finenter` | 进门投研 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.flova` | Flova | mcp, skills | 通过 | Chrome 已接收授权 URL；无头超时 | 需要账号授权 |
| `moss.fuma-ai-callout` | 福马AI外呼任务 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.fyopen-lawsearch` | 法研·法律法规检索 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.gangtise-mcp` | Gangtise投研 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.gaodun-job` | 高顿•实习就业助手 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.gildata` | 恒生聚源 MCP | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.h3c-cloudnet` | 新华三Cloudnet灵犀AI助手 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.h3yun-connector` | 氚云 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.ihr-cli` | i人事AI·HR专家 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.infimind-ecommerce-image` | 极睿电商生图 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.infimind-video` | 极睿视频 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.ioa` | 零信任安全 iOA | mcp, cli | 通过 | CLI 登录页已打开 | 设备码登录后可继续 |
| `moss.jinshuju` | 金数据 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.jiushuyun` | 九数云BI | mcp | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.kling-ai-plugin` | Kling AI（中国） | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.kling-ai-plugin-ai` | Kling AI（海外） | mcp, skills | 通过 | Chrome 已接收授权 URL；无头超时 | 需要账号授权 |
| `moss.kuaicha-search` | 同花顺快查企业数据 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.lemonclaw` | LemonClaw | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.lexiang` | 乐享知识库 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.linear-mcp` | Linear | mcp | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.lingxing-mcp` | 领星ERP | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.linkfox-product-selection` | Linkfox 选品 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.lovrabet-cli` | Lovrabet CLI | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.mastergo-vibe-mcp` | MasterGo 莫高设计 | mcp, skills | 通过 | 原有授权 | 只读成功：get_version |
| `moss.mglc` | 芒果灵创 CLI | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.miaoda` | 秒哒应用搭建 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.moka` | Moka HR 智能体 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.morningstar` | 晨星 Morningstar | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.mx-ds-mcp` | 东方财富妙想MCP | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.mzl-trademark` | 摩知轮商标查询 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.neo-crm` | 销售易CRM | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.netease-mail` | 网易邮箱 | skills | 通过 | 配置表单 | 未验证调用 |
| `moss.notion` | Notion | mcp, skills | 通过 | Chrome 已接收授权 URL；无头超时 | 需要账号授权 |
| `moss.opendata` | 及刻智能·时空数据MCP | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.pandadata` | PandaData 金融数据 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.patsnap-search` | 智慧芽专利&文献融合检索 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.picset-commerce-images` | Picset AI 电商图片 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.picset-video-generation` | Picset AI 视频创作 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.pkulaw` | 北大法宝·法律智能检索 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.proboost` | OpenBoost 跨境数据 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.qcc-company` | 企查查 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.qcc-legal` | 企查查·法律数据 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.qingflow` | 轻流 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.qq-mail` | QQ邮箱 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.ragflow` | RAGFlow 企业知识库 | mcp, skills | 通过 | Moss 会话或 API Key | 隔离探测缺少会话令牌 |
| `moss.seeyon-office-marketing-suite` | 致远互联协同办公服务 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.shanglv-mcp-gateway` | 用友智能服务（AI BaaS） | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.shanlong-claw` | 商龙经营洞察 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.sharecrm` | 纷享销客CRM | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.shareone` | ShareOne | skills | 通过 | 配置表单 | 只读成功：技能 API |
| `moss.sq-company-dynamic` | 上奇产业通-企业动态追踪 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.tanyuan-assistant` | TDC 文化智能体 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tapd` | TAPD | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tc-chengxin` | 同程程心 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.tec-do` | Tec-Do 2.0 广告与增长情报 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tencent-docs` | 腾讯文档 | mcp | 通过 | 原有授权 | 只读成功：get_user_info |
| `moss.tencent-docs-oa` | 腾讯文档企业版 | mcp | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tencent-health-nges` | 腾讯健康NGES | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tencent-map` | 腾讯地图 | mcp | 通过 | 配置表单 | 需要配置 |
| `moss.tencent-weiyun` | 微云 | mcp, skills | 通过 | 原有授权 | 只读成功：weiyun.recent_list |
| `moss.tencentads` | 腾讯营销投放 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.textin-xparse` | TextIn xParse·智能文档解析 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.textin-xparse-ai` | TextIn xParse·智能文档解析 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.tiktok` | TikTok for Business | mcp | 通过 | MCP 登录 URL 未取得 | MCP 探测失败：network |
| `moss.tmeet` | 腾讯会议 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.tongzhou-fin-research` | 同舟金融研究 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tplus-api` | 畅捷通T+ | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.tushare` | Tushare | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.tyc-mcp` | 天眼查 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.uupt` | UU跑腿 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.wecom` | 企业微信 | cli, skills | 通过 | CLI 登录页已打开 | 实际调用报授权过期 |
| `moss.weisheng-scrm` | 微盛企微管家SCRM | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.wind-finance` | Wind 金融数据 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.wisenote` | 百智WiseNote | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.wk-workbuddy` | 威科先行 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.woscli` | 微盟 WOS CLI | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.wps-knowledgebase` | WPS知识库 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.xiaoe-cloud-cli` | 小鹅通 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.xingtu-claw-risk` | 天创信用星图MCP | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.yingmi-mcp` | 盈米MCP | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.youshu-bd-mate` | 智客AI · 对公(To B)营销助手 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.yuandian-mcp` | 华宇元典法律数据 | mcp | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.yunke-cli` | 云客AI工作手机 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |
| `moss.yzf-general-mcp-server` | 云帐房AI财税 | mcp | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.yzf-invoice-mcp-server` | 云帐房AI开票 | mcp, skills | 通过 | MCP 登录页已打开 | 需要账号授权 |
| `moss.zfs-fssc-ai` | 中兴新云AI智报 | mcp, skills | 通过 | 配置表单 | 需要配置 |
| `moss.zsxq` | 知识星球 | cli, skills | 通过 | CLI 登录页已打开 | 未验证调用 |

## 证据

逐项 JSON、构建日志和重测结果见 [`artifacts/connector-apps-local-check`](../artifacts/connector-apps-local-check)。验收 JSON 已过滤删除的 App，并在 `removedAppIds` 中保留变更记录。复核脚本位于 [`scripts/research`](../scripts/research)。`bun test ./scripts/connector-apps.test.ts` 的 5 项测试通过。福帮手与认证页的复测结果在同一证据目录的独立文件中。
