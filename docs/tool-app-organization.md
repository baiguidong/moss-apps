# 应用与工具组织规范

## 两种交付形态

- `apps/<name>`：需要自定义 Moss UI / Backend 的应用工程，保留标准 Manifest、package.json、源码、测试与构建入口。应用仍可提供 MCP、CLI 或 Skills。
- `tool-apps/<name>`：声明式工具包，只维护 app.json、marketplace.json、README.md 和可选资源。MCP、CLI、Skills 可以组合，不按能力复制 App。
- 本地 / 在线描述服务属性，与交付形态及运行进程的位置无关；Host 自动提供的设置页不算独立业务 UI。

当前整理后有 27 个应用工程、121 个工具包。工具包由原有 7 个配置型 MCP 工具和 114 个连接器服务组成。MCP 管理、数据库查询等有自定义页面的应用仍位于 apps，不因内部使用 MCP 而改成工具。

## 工具定义

所有工具统一使用 schemaVersion 1 的 app.json 与 scripts/build-tool-app.mjs。公共字段包括 id、version、displayName、description、category、keywords、icon、publisher、toolScope 和 discovery。

纯 MCP 定义使用 mcpServers、presentation、runtime，沿用现有 Core MCP 生命周期及内置设置页。连接器定义使用 connector 保存账号、凭据表单和技能元数据，并按需声明 mcp、cli。原 mcp.json 的别名和认证变体完整保留，不要求转换成简单 URL；凭据表单从 connector.credentialSchema 生成，不再同时维护 token-schema.json。

资源图标放在 resources/assets；附带技能、CLI 安装脚本等保留在 connector 中；已有 MCP 服务的随包运行依赖保留在 runtime 中。真实 Token、密码及用户数据不得放入定义或资源。

```sh
node scripts/run-apps.mjs check --app moss.linear-mcp
node scripts/run-apps.mjs build --app moss.dingtalk
node scripts/package-app.mjs --app moss.linear-mcp
```

生成后的运行包仍使用标准 app.moss.json。工具没有自己的工程样板；源码导出时才生成临时 package.json、Manifest、共享构建入口与聚焦锁文件，支持独立重建。工具包自身的回归测试集中放在 scripts；每个配置无需伪造测试命令。

## 市场与 Moss 分区

主分区只保留“应用 / 工具”，默认进入应用，配合名称与用途搜索；不再提供全部、能力或本地 / 在线下拉筛选。MCP、CLI、Skills 及本地 / 在线仅作为卡片信息标签，也可通过搜索发现。混合工具仅有一份安装身份，纯 Skills 工具同样可以发现。

市场目录通过 discovery.kind 与 discovery.capabilities 发布展示信息，Host 从已安装 Manifest 推导相同信息。展示分类不授予执行权限；原有 connector:use 或 MCP 权限仍独立验证。缺少交付形态的第三方旧包默认保留在应用分区，不因缺失分类而隐藏。旧全部、本地 / 在线主分区偏好升级为应用，保留已有的应用 / 工具偏好。

## 用途分类

统一由 Core SDK 的 Manifest schema 定义分类 ID、中文名称和显示顺序，应用与工具共享同一套分类。分类不再依据 MCP / CLI 协议、认证方式或运行位置推断；按最主要的业务用途归属，每个条目只出现一次。界面只显示当前分区中实际存在的分类。

| 分类 | 数量 | 典型条目 |
| --- | ---: | --- |
| 沟通协作 | 11 | 钉钉、飞书、邮箱、会议 |
| 文档与知识 | 16 | 知识库、Notion、PDF、文档解析 |
| 文件与存储 | 6 | 文件系统、网盘、备份 |
| 设计与音视频 | 16 | Canva、Draw.io、图片与视频生成 |
| 开发工具 | 12 | Git、CloudBase、TAPD、应用构建 |
| 数据与分析 | 9 | 数据库、Excel、BI、数据采集 |
| 自动化 | 9 | 工作流、浏览器操控、低代码流程 |
| AI 与智能体 | 5 | MCP 管理、记忆、分步思考 |
| 销售与客户 | 6 | CRM、外呼、云客 |
| 营销与电商 | 8 | 广告投放、选品、内容运营 |
| 金融与投研 | 10 | Wind、Tushare、基金、研报 |
| 经营与财税 | 9 | ERP、供应链、开票、报销 |
| 人事与招聘 | 4 | 北森、i人事、Moka、就业 |
| 教育与文化 | 3 | 粉笔、小鹅通、文化检索 |
| 法律与风控 | 15 | 法律检索、企业尽调、征信、知识产权 |
| 出行与生活 | 4 | 携程、同程、地图、跑腿 |
| 诊断与安全 | 5 | 审计、追踪、自测、Bugly、iOA |

当前 148 个条目均有明确分类，“其他”为 0；“其他”只为未知第三方或未来分类保留兜底。回归测试检查官方源条目不得使用“其他”。旧官方安装包使用按 ID 和原分类限定的展示迁移，不改写磁盘上的 Manifest，不覆盖后续显式自定义分类，也不触碰凭据和用户数据。新增分类的运行包要求 Host API >=3.21.0，避免旧 Host 将不识别的分类误报为损坏包。

## 兼容与发布

App ID、connector ID、技能名称、账号关联、权限及原始 MCP / CLI 配置保持不变。源码重组不读取、不移动用户的安装目录和凭据。已有两种运行适配器保留，统一的是源码入口、生成与发现方式，不强行合并认证语义。

已跟踪工具的版本提升一个 patch，避免重新发布覆盖包含旧源码的不可变版本；新加入且未跟踪的 DBX 工具保留初始版本。本地校验和构建不代表线上发布。Core 修改须先提交、推送并固定到 vendor/moss-core 后，才能通过现有签名发布门禁。
