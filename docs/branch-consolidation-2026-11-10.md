# 2026-11-10 分支收敛记录

Browser Use、Excel、MarkItDown、Git 的版本更新已由 df72c3e 合并进入 main。本次 DBX 数据目录修正另以正常代码提交进入 main，版本更新为 0.1.4；11 项工具 App 测试和 DBX 清单验证通过。

## 历史诊断分支

下列分支的生产修复已被主线吸收，剩余差异是一次性 CI 诊断配置。采用保留当前 main 实现的历史合并，将原头提交纳入 main 祖先；不将诊断开关混入当前发布流程。

| 原分支 / 提交 | 核对结论 |
| --- | --- |
| release/settings-rebuild-diagnostics · 4c09ec9 | 可重建 settings/UI 修复已在 main。旧工作流会用 Linux→Windows 单 App 调试任务替换 Release Changed Apps，另包含临时导出重建字节差异；保留当前跨平台验证及自动发布流程。 |
| release/windows-native-diagnostics · cbe5e67 | live capability readiness 和 discovery 数据保留等修复已在主线。剩余为临时 SDK/MCP 传输切换、进程与调用日志、旧固定版本 0.2.1 的 Windows 测试补丁，会覆盖发布入口；保留当前生产驱动及已集成的 Windows 测试。 |

诊断实现仍可通过上述 Git 历史读取。其余本地和 origin 分支的头提交原本均为 main 祖先，验证后删除引用。

旧 detached worktree 中的 DBX 原型草稿、历史 stash、依赖及测试输出不删除，也不重新引入到当前 App 目录；当前工具 App 实现已有归档权限处理、平台依赖打包和 DBX 验证。现有 branch worktree 改为 detached HEAD 保留文件。后续新工作直接在 main 提交。
