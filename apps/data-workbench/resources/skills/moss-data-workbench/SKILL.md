---
name: moss-data-workbench
description: 使用 Moss 本地数据工作台的受管 DuckDB CLI 查询和导出本地 CSV、JSON、Parquet 等文件，并与页面共享任务结果。
---

使用 App 上下文中的 cliPath、dataDir、nodeExecutable、nodeArgs 和 env。不要猜测安装路径。将请求保存为 UTF-8 JSON 文件后，调用：

node <cliPath> --data-dir <dataDir> describe
node <cliPath> --data-dir <dataDir> run --input-file <absolute-request.json>
node <cliPath> --data-dir <dataDir> list
node <cliPath> --data-dir <dataDir> show <task-id>
node <cliPath> --data-dir <dataDir> cancel <task-id>

页面提供文件预览、SQL 查询和 CSV/JSON/Parquet 导出。Agent 可用 mode=query 执行完整 DuckDB SQL；mode=raw 将 args 数组作为 DuckDB CLI 参数直接传给固定版本引擎。需要将 raw 模式的输出归档时，设置 outputName，并在 args 中以 {output} 引用本次任务目录中的目标文件。数组元素是独立参数，不包含 shell 引号。

示例请求：{"mode":"query","sql":"SELECT 1 AS id"}

导出示例：{"mode":"export","sql":"SELECT * FROM read_csv_auto('/absolute/input.csv')","format":"parquet","outputName":"result.parquet"}

查询可以访问用户授权范围内的绝对路径。执行后检查任务的 status、message、result 和 artifacts；任务 ID 本身不表示成功。修复页面失败任务时先 show，核对原始输入和错误，再用新请求创建任务。不要改写其他 App 的数据目录。
