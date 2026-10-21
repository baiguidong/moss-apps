---
name: moss-media-tools
description: 使用 Moss 音视频工坊的受管 FFmpeg/ffprobe，执行页面常用处理或通过完整 FFmpeg 参数完成高级媒体任务，并共享任务结果。
---

使用 App 上下文中的 cliPath、dataDir、nodeExecutable、nodeArgs 和 env。将请求保存为 UTF-8 JSON 文件后调用：

node <cliPath> --data-dir <dataDir> describe
node <cliPath> --data-dir <dataDir> run --input-file <absolute-request.json>
node <cliPath> --data-dir <dataDir> list
node <cliPath> --data-dir <dataDir> show <task-id>
node <cliPath> --data-dir <dataDir> cancel <task-id>

页面提供媒体信息、预览、裁剪、压缩、WAV 提取、GIF 和 MP4 转换。Agent 可使用 mode=raw 的 args 数组传入完整 FFmpeg 参数，必须以 {output} 占位指定本次任务产物，并用 outputName 指定文件名。使用参数数组，不拼接 shell 命令；滤镜表达式是单个参数。若任务需要多个产物，可分别运行或让 FFmpeg 生成一个主产物。

裁剪示例：{"mode":"trim","path":"/absolute/input.mp4","start":1.2,"end":5.5}

高级示例：{"mode":"raw","args":["-hide_banner","-nostdin","-i","/absolute/input.mp4","-vf","scale=1280:-2","{output}"],"outputName":"scaled.mp4"}

结果中的 status、message、artifacts 和实际媒体元数据是成功依据。使用 show 查看失败日志与 argv，修正后重新 run。不得将未完成文件或播放器能打开的预览副本当作最终产物。
