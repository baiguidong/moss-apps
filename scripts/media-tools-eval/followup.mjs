import { cases, project } from './cases.mjs'

// Test copy only. Parameter names, enums and backend behavior match the original seven tools.
export function clarify(tool) {
  if (tool.id === 'video_render') {
    tool.description = '按已保存项目的 id 和 version 生成 MP4。分镜动画仅能生成视频。数字人口播还可以单独试听配音；生成口播视频时要打开项目预览。'
    tool.schema.properties.output.description = '默认 video，两类项目都支持。speech 仅适用于 avatar（数字人口播），animation（分镜动画）无法单独试听配音。'
  }
  if (tool.id === 'media_edit') {
    tool.schema.properties.args.description = 'raw 接收 FFmpeg 自身的处理参数，必须实际生成 {output} 文件；不能用于查询安装版本或运行 ffprobe 命令。'
  }
  if (tool.id === 'media_get') {
    tool.schema.properties.type.description += ' settings 返回口播角色、音色、画幅和画质。当前会话工具不提供 FFmpeg 或 ffprobe 的版本信息。'
  }
  return tool
}

const repeats = ['speech-on-animation', 'engine-version', 'speech-only', 'render', 'inspect']
const speech = cases.find(c => c.id === 'speech-on-animation')
const version = cases.find(c => c.id === 'engine-version')
export const followupCases = [
  ...repeats.map(id => cases.find(c => c.id === id)),
  { ...speech, id: 'narration-preview', replyCriterion: speech.id,
    prompt: `我在做分镜动画（${project}，目前第 17 版），只想听工坊给它念出来，别做成片。能直接播就播，不支持就告诉我。` },
  { ...speech, id: 'unknown-project-kind', replyCriterion: speech.id,
    prompt: `我只记得项目号 ${project}，不记得类型和版本。帮我看看这个项目支持单独听数字人配音吗？支持就试听，不用出片。` },
  { ...version, id: 'bundled-versions', replyCriterion: version.id,
    prompt: '我要登记工坊自带的 FFmpeg、ffprobe 各自的版本号，系统 PATH 上的那个不算。用当前会话工具核对一下。' },
  { ...version, id: 'probe-version', replyCriterion: version.id,
    prompt: '帮我确认工坊自带的 ffprobe 是哪个版本，只查版本，别创建作业。' },
]
