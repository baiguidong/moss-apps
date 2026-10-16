import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import model from '../../resources/model.json' with {type:'json'}
import ffmpegSpec from '../../resources/ffmpeg.json' with {type:'json'}
import { ensureBinary } from '@moss/engine-apps/runtime'
import { restoreBundledAsset } from '@moss/engine-apps/bundled'
import { runProcess } from '@moss/local-tasks/worker'
import { atomicJson } from '@moss/local-tasks/backend'

export const MODEL = { name:model.executable, size:model.size, sha256:model.binarySha256, revision:model.version }
const FORMATS = new Set(['wav', 'mp3', 'm4a', 'mp4', 'mov', 'webm', 'ogg', 'flac', 'aac', 'mkv', 'aiff', 'aif', 'opus'])
export async function inspect(file) {
  const format = path.extname(file).slice(1).toLowerCase()
  if (!FORMATS.has(format)) throw new Error('请选择常见音频或视频文件，如 WAV、MP3、M4A、MP4')
  return { kind: ['mp4', 'mov', 'webm', 'mkv'].includes(format) ? 'video' : 'audio', metadata: { format } }
}
export function validate(input, files) {
  if (!Array.isArray(input.fileIds) || input.fileIds.length !== 1 || !files.some(f => f.id === input.fileIds[0] && ['audio', 'video'].includes(f.kind))) throw new Error('请选择一个录音或视频文件')
  const language = input.options?.language || 'auto'
  if (!['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'].includes(language)) throw new Error('不支持的语言')
  return { fileIds: input.fileIds, title: `转写 ${files.find(f => f.id === input.fileIds[0]).name}`, options: { language } }
}
export async function ensureModel(dataDir, signal, progress) {
  signal.throwIfAborted(); progress(0, '准备随包识别模型')
  const bundled = fileURLToPath(new URL('../models/' + MODEL.name, import.meta.url))
  return restoreBundledAsset(bundled, path.join(dataDir, 'models', MODEL.revision, MODEL.name), MODEL.sha256, signal)
}

export function subtitleTime(value, separator = ',') {
  const ms = Math.max(0, Math.round(value * 1000)), hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`
}
export function serializeTranscript(segments) {
  const line = text => text.replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
  return { txt: segments.map(s => s.text).join('\n'), srt: segments.map((s, i) => `${i + 1}\n${subtitleTime(s.start)} --> ${subtitleTime(s.end)}\n${line(s.text)}`).join('\n\n') + '\n', vtt: 'WEBVTT\n\n' + segments.map(s => `${subtitleTime(s.start, '.')} --> ${subtitleTime(s.end, '.')}\n${line(s.text)}`).join('\n\n') + '\n' }
}
export function normalizeSegments(segments, duration) {
  // whisper.node already converts whisper.cpp ticks to milliseconds.
  return segments.map(s => ({ start: Math.max(0, s.t0 / 1000), end: Math.min(duration, s.t1 / 1000), text: s.text.trim() })).filter(s => s.text && s.end > s.start)
}
async function writeTranscript(dir, transcript) {
  const text = serializeTranscript(transcript.segments)
  for (const [ext, content] of Object.entries(text)) { const file = path.join(dir, `逐字稿.${ext}`), temporary = file + '.tmp'; await fs.writeFile(temporary, content); await fs.rename(temporary, file) }
  await atomicJson(path.join(dir, '逐字稿.json'), transcript)
}
export async function execute({ input, files, outputDir, dataDir, signal, progress }) {
  const file = files.find(f => f.id === input.fileIds[0]), model = await ensureModel(dataDir, signal, progress)
  progress(21, '准备音频')
  const executable = await ensureBinary(ffmpegSpec, dataDir, signal)
  const audioPath = path.join(outputDir, '播放音频.wav')
  await runProcess(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file.path, '-vn', '-t', '7201', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', audioPath], { signal })
  const audio = await fs.readFile(audioPath)
  let offset = 12, pcm
  while (offset + 8 <= audio.length) { const type = audio.toString('ascii', offset, offset + 4), size = audio.readUInt32LE(offset + 4); if (type === 'data') { pcm = audio.subarray(offset + 8, Math.min(audio.length, offset + 8 + size)); break } offset += 8 + size + (size % 2) }
  if (!pcm?.length) throw new Error('音频中没有可识别的内容')
  const duration = pcm.length / 32000
  if (duration > 7200) throw new Error('首版支持最长 2 小时的录音，请先拆分文件')
  progress(25, '正在加载本地识别模型')
  const { initWhisper } = await import('@fugood/whisper.node')
  const context = await initWhisper({ filePath: model, useGpu: process.platform === 'darwin' })
  const job = context.transcribeFile(audioPath, { language: input.options.language, temperature: 0, maxThreads: 4, onProgress: n => progress(25 + n * 0.73, `语音转写 ${Math.round(n)}%`) })
  const stop = () => { void job.stop() }; signal.addEventListener('abort', stop, { once: true })
  let recognized
  try { recognized = await job.promise; signal.throwIfAborted(); if (recognized.isAborted) throw new Error('已取消') }
  finally { signal.removeEventListener('abort', stop); await context.release() }
  const segments = normalizeSegments(recognized.segments, duration)
  const waveform = Array.from({ length: 180 }, (_, i) => { const from = Math.floor(pcm.length / 2 * i / 180), to = Math.floor(pcm.length / 2 * (i + 1) / 180); let max = 0; for (let n = from; n < to; n += Math.max(1, Math.floor((to - from) / 300))) max = Math.max(max, Math.abs(pcm.readInt16LE(n * 2)) / 32768); return Math.round(max * 1000) / 1000 })
  await writeTranscript(outputDir, { revision: randomUUID(), sourceId: file.id, duration, waveform, language: recognized.language || input.options.language, segments })
  return { files: [{ path: audioPath, kind: 'audio', metadata: { duration } }, { path: path.join(outputDir, '逐字稿.json'), kind: 'transcript', metadata: { duration, segments: segments.length } }, ...['txt', 'srt', 'vtt'].map(ext => ({ path: path.join(outputDir, `逐字稿.${ext}`), kind: 'text' }))], message: `已转写 ${segments.length} 个片段，可播放和校对` }
}
const editing = new Set()
export const extraActions = {
  'transcript.save': async (service, input) => {
    const file = service.file(input.id)
    if (file.kind !== 'transcript') throw new Error('请选择逐字稿')
    if (editing.has(file.id)) throw new Error('正在保存，请稍后重试')
    editing.add(file.id)
    try {
      const json = await service.filePath(file), current = JSON.parse(await fs.readFile(json, 'utf8'))
      if (current.revision !== input.revision) throw new Error('逐字稿已被其他页面修改，请重新打开后校对')
      if (!Array.isArray(input.segments) || input.segments.length !== current.segments.length) throw new Error('片段数量不一致')
      for (const [i, segment] of input.segments.entries()) if (segment.start !== current.segments[i].start || segment.end !== current.segments[i].end || typeof segment.text !== 'string' || segment.text.length > 4000) throw new Error('首版只支持修改片段文字，时间戳保持不变')
      current.segments = input.segments; current.revision = randomUUID(); await writeTranscript(path.dirname(json), current)
      for (const sibling of service.state.files.filter(f => f.taskId === file.taskId)) sibling.size = (await fs.stat(await service.filePath(sibling))).size
      await service.save(); service.changed(); return { revision: current.revision }
    } finally { editing.delete(file.id) }
  },
}
