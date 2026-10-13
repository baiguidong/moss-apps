# Draw.io

在 Moss 会话中选择 Draw.io 后，可用自然语言创建和编辑流程图、架构图及 Mermaid 图表，打开返回的链接继续编辑和导出。

此应用只有 MCP 配置和资源，公共页面及运行管理由 Moss Core 内置提供。安装时只需导入 Draw.io 包，需要本次实现的 Host API 3.9。

启动命令为 `npx -y @drawio/mcp`。首次启动可能需要联网下载；命令保留未锁版本写法。本次验证解析到 `drawio-mcp 1.6.3`。项目来源：https://github.com/jgraph/drawio-mcp 。图标为本配置提供的流程图示意图。

应用声明为可安全重启：图表由链接或本地文件承载。Moss 默认在空闲 60 分钟后回收进程，下次调用自动启动；时间可在 Moss 的高级设置 → Agent 与执行中调整。
