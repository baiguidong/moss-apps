# Trace

查看 Moss 本地模型请求、响应、完整提示词、工具调用和异常。需要支持 Host API `^2.5.0` 的 Moss Desktop。

在应用管理中安装并启用 Trace 后自动采集，停用或卸载立即停止。页面无需另设采集开关；关闭页面或后台按需进程退出不会停止采集。未安装时不采集。启用只影响后续请求，不补录停用期间的数据。

Core 在应用实例数据目录的 `trace/traces/<sessionId>.jsonl` 写入版本化记录，在 `trace/sessions/<sessionId>.json` 写入会话信息。App 读取自己的文件，在 `trace/db/trace-index-v1.sqlite` 建立可重建索引，负责列表、搜索、诊断和删除。`moss.trace/v1` 仅提供采集状态，不提供结果查询、采集开关或任意目录设置。目录由 Desktop 根据已安装 App 的身份确定。

首次启用会复制旧本地 Trace JSONL 到 App 数据目录，保留源文件。旧采集设置不再影响 Desktop。卸载保留数据时可以重新安装后查看；选择删除数据则清除 App 文件。删除仍在产生请求的会话记录后，后续新记录可以重新出现。服务器 Trace 接口保持原有行为，本 App 首版只显示本地记录。

请求中的常见认证字段由 Core 脱敏；对话和提示词保存在本机 App 数据目录。写入失败或队列满会显示在列表顶部。详情采用分块传输，单次结果上限 32 MiB。

```sh
bun install --frozen-lockfile
bun run --cwd apps/trace check
bun run --cwd apps/trace test
bun run --cwd apps/trace test:browser
bun run --cwd apps/trace build
```

发布标签 `moss.trace-v0.1.0` 触发 CI 检查、浏览器验证、签名打包及市场更新。
