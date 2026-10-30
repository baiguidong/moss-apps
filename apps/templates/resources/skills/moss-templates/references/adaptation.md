# Codex 插件适配记录

来源：OpenAI template-creator 26.1007.11041。保留创作、质量检查和用户意图优先的规范；宿主调用替换为 Moss App tools、任务记录与资源引用。

源文件 SHA-256：f1d14fd2847a2e879611a8b8f872f5dc4676a0607958d015274d2dc61e812deb。

不依赖 Codex 运行时、artifact session、专属引用指令、遥测脚本或 Google/Excel 连接。本次任务的文件、预览、创作源文件和版本记录保存在当前会话 workspace；删除会话会一并清理。工具资源按需只读访问，App 私有目录仅保存引擎缓存。未适配的云连接操作不声称可用。
