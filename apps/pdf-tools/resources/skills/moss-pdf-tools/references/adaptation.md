# Codex 插件适配记录

来源：OpenAI pdf 26.1007.11041。保留创作、质量检查和用户意图优先的规范；宿主调用替换为 Moss App tools、任务记录与资源引用。

源文件 SHA-256：a6e20f4ae66364a06d577dd51e0ce66ee2ef955be129cbe195e0a27f403daaf8。

不依赖 Codex 运行时、artifact session、专属引用指令、遥测脚本或 Google/Excel 连接。本次任务的文件、预览、创作源文件和版本记录保存在当前会话 workspace；删除会话会一并清理。工具资源按需只读访问，App 私有目录仅保存引擎缓存。未适配的云连接操作不声称可用。
