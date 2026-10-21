import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureBinary, existingPaths, run, argv } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with { type: 'json' }
import probeSpec from '../../resources/ffprobe.json' with { type: 'json' }

const modes = ['inspect', 'trim', 'compress', 'audio', 'gif', 'convert', 'raw']
const names = { trim: '裁剪视频.mp4', compress: '压缩视频.mp4', audio: '提取音频.wav', gif: '动图.gif', convert: '转换视频.mp4' }
const outputName = value => {
  if (typeof value !== 'string' || !/^[^/\\\0]{1,160}$/.test(value) || value === '.' || value === '..') throw new Error('输出文件名无效')
  return value
}
const finite = (value, label, min, max) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(label + '无效')
  return number
}
export async function buildCommand(input, directory) {
  if (!input || !modes.includes(input.mode)) throw new Error('请选择音视频操作')
  if (input.mode === 'raw') {
    const args = argv(input.args || [])
    if (!args.length) throw new Error('请输入 FFmpeg 参数')
    const output = path.join(directory, outputName(input.outputName || '处理结果.mp4'))
    if (!args.some(arg => arg.includes('{output}'))) throw new Error('高级参数需用 {output} 指定本次任务产物')
    return { args: args.map(arg => arg.replaceAll('{output}', output)), output }
  }
  const inputPath = (await existingPaths([input.path]))[0]
  if (input.mode === 'inspect') return { inputPath, args: [] }
  const output = path.join(directory, outputName(input.outputName || names[input.mode]))
  const args = ['-hide_banner', '-nostdin', '-y']
  if (input.mode === 'trim') {
    const start = finite(input.start, '开始时间', 0, 864000)
    const end = finite(input.end, '结束时间', 0, 864000)
    if (end <= start) throw new Error('结束时间必须晚于开始时间')
    args.push('-ss', String(start), '-i', inputPath, '-t', String(end - start), '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac')
  } else if (input.mode === 'compress') {
    const crf = finite(input.crf ?? 28, '画质', 18, 40)
    args.push('-i', inputPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-c:a', 'aac', '-b:a', '128k')
  } else if (input.mode === 'audio') {
    args.push('-i', inputPath, '-vn', '-c:a', 'pcm_s16le', '-ar', '48000')
  } else if (input.mode === 'gif') {
    const width = finite(input.width ?? 640, '动图宽度', 64, 1920)
    const fps = finite(input.fps ?? 10, '动图帧率', 1, 30)
    args.push('-i', inputPath, '-vf', 'fps=' + fps + ',scale=' + width + ':-1:flags=lanczos', '-loop', '0')
  } else if (input.mode === 'convert') {
    args.push('-i', inputPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart')
  }
  args.push('-progress', 'pipe:2', output)
  return { inputPath, args, output }
}
async function probe(file, ctx) {
  const binary = await ensureBinary(probeSpec, ctx.dataDir, ctx.signal)
  const result = await run(binary, ['-v', 'error', '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,sample_rate', '-of', 'json', file], { signal: ctx.signal, log: ctx.log })
  return JSON.parse(result.stdout)
}
export default {
  id: 'ffmpeg', spec,
  async catalog({ dataDir, prepare }) {
    if (prepare) await Promise.all([ensureBinary(spec, dataDir), ensureBinary(probeSpec, dataDir)])
    return { version: spec.version, modes, ffprobeVersion: probeSpec.version }
  },
  async validate(input) { await buildCommand(input, '/tmp/moss-media-validation') },
  async execute(input, ctx) {
    await ctx.progress('准备音视频引擎')
    const { inputPath, args, output } = await buildCommand(input, ctx.directory)
    if (input.mode === 'inspect') {
      const metadata = await probe(inputPath, ctx)
      return { result: metadata, readRoots: [inputPath], artifacts: [{ name: path.basename(inputPath), path: inputPath, kind: /\.(mp3|wav|m4a|aac|ogg)$/i.test(inputPath) ? 'audio' : 'video' }], message: '媒体信息已读取' }
    }
    const binary = await ensureBinary(spec, ctx.dataDir, ctx.signal)
    await ctx.record?.({ argv: args })
    await ctx.progress('正在处理媒体')
    let pending = '', lastProgress = 0, progressWrite = Promise.resolve()
    const log = chunk => {
      ctx.log(chunk)
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('out_time=') && Date.now() - lastProgress > 1000) {
          lastProgress = Date.now()
          progressWrite = progressWrite.then(() => ctx.progress('已处理到 ' + line.slice('out_time='.length)))
        }
      }
    }
    const execution = await run(binary, args, { signal: ctx.signal, log })
    await progressWrite
    const stat = await fs.stat(output).catch(() => null)
    if (!stat?.isFile() || stat.size === 0) throw new Error('FFmpeg 未生成有效文件')
    let metadata = null
    try { metadata = await probe(output, ctx) } catch {}
    const extension = path.extname(output).toLowerCase()
    const kind = ['.mp4', '.mov', '.mkv', '.webm'].includes(extension) ? 'video' : ['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(extension) ? 'audio' : extension === '.gif' ? 'image' : 'document'
    return { argv: args, result: { bytes: stat.size, metadata }, warnings: execution.stderr.slice(-3000), artifacts: [{ name: path.basename(output), path: output, kind }], message: '媒体文件已生成' }
  },
}
