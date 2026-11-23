---
name: moss-media-studio
description: 在同一工坊批量处理图片、剪辑音视频、转写字幕、制作分镜动画与数字人口播，查询及导出任务产物。
---

图片用 image_import 导入本地文件，再用 image_process 提交 fileIds 和 options。用 image_get 查看进度和输出文件 ID，image_export 按文件 ID 导出，image_cancel 按任务 ID 取消。页面的「任务中心」可以查看图片和音视频任务、打开处理结果。

对已有音视频调用 media_edit。支持 inspect、trim、compress、audio、gif、convert。裁剪传 path、start、end（秒）。要字幕或逐字稿则调用 media_transcribe，传本地 path 和可选 language。用 media_get 的 type=task 查询任务，成功后按 artifacts 数组下标调用 media_export。type=artifact 可按 id、index 读取文本。

用 video_project_save 创建可编辑作品。口播传 kind=avatar 和 fields，例如 {"name":"产品介绍","script":"大家好。"}。分镜传 kind=animation 和 animation，例如 {"name":"产品演示","aspectRatio":"16:9","duration":15}。用 media_get 的 type=project 读取项目。在已有项目上保存时传 id 和最新 version；口播传 fields，动画传完整 storyboard 或一对 sceneId、html。场景仅使用离线 HTML/CSS，每个镜头从自己的零秒开始计时。检查返回的 warnings。media_get 的 type=validate 可以检查项目。

用户要求成片时调用 video_render，传 id、version，默认生成 MP4 并返回任务 ID。分镜动画只支持成片，镜头的 narration 是文案。只有数字人口播支持 output=speech 单独试听，生成口播视频时需打开对应项目预览。项目类型或版本未知时，先用 media_get 的 type=project 读取。用户取消时用 media_cancel。

media_get 的 type=settings 返回口播角色、音色、画幅和画质。工坊随包的 FFmpeg 和 ffprobe 版本可通过工坊 CLI 的 describe 命令查询。CLI 使用 App 上下文中的 nodeExecutable、nodeArgs、cliPath、dataDir 和 env，也支持 run --input-file、list、show 和 cancel。media_edit 的 mode=raw 接收 FFmpeg 自身的 args 数组，每项一个参数，必须实际生成 {output} 文件。
