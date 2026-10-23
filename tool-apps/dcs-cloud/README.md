# DCS Cloud

引导 dcs CLI（下载、自动更新、PAT 登录），之后直接执行 CLI 操作 DCS Cloud：项目、任务、工作流、计费、数据文件。用户需在云平台个人中心创建个人访问令牌(PAT)并粘贴到连接器。

从 Moss 应用市场安装，在 Apps → 管理中配置账号；在会话中选择后使用。

分类：工具。服务：在线。认证：api-key。

本目录通过 app.json 声明工具、认证及 MCP / CLI 能力，附带的技能与资源由 Moss Host 管理。构建校验：`node ../../scripts/build-tool-app.mjs --check`；通过仓库的标准签名、源码随包和市场发布流程交付。
