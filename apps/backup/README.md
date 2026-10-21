# 备份与恢复

Moss App 使用固定版本 Restic 0.19.1。页面可设置加密密码、初始化本地备份库、备份目录、浏览快照与文件、恢复到指定目录、检查备份库。密码由 Moss 凭据库保存，任务记录与结果不包含密码。Agent 通过原生工具提交相同任务；command=raw 可使用 Restic 完整非交互命令参数，修改备份库时需填写 confirmChanges。

当前发行包声明 macOS Apple Silicon。后台随 Moss Desktop 退出，首版提供手动任务，不提供无人值守定时备份。恢复目标必须是已有目录，恢复可能覆盖其中同名文件，操作前应检查目录内容。备份库密码遗失后无法恢复数据。

开发：bun run --cwd apps/backup check / test / build；从仓库根目录使用 node scripts/package-app.mjs --app moss.backup 打包。
