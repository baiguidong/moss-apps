import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { AppProcessSupervisor } from '../vendor/moss-core/packages/app-runtime/src/process/index.mjs'

const app = path.resolve(process.argv[2] || fileURLToPath(new URL('../apps/media-studio/', import.meta.url)))
const manifest = JSON.parse(await fs.readFile(path.join(app, 'app.moss.json'), 'utf8'))
const require = createRequire(path.join(app, manifest.backend.entry))
const sharp = require('sharp')
const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-media-smoke-')))
const dataDir = path.join(temporary, 'data')
const logs = []
const exportDir = path.join(temporary, 'export')
await fs.mkdir(exportDir)
let fileToPick
const supervisor = new AppProcessSupervisor({
  processesDir: path.join(temporary, 'processes'),
  onLog(entry) { logs.push(entry.message) },
  onHostRequest({ protocol, method, input }) {
    if (protocol === 'moss.runtime/v1' && method.startsWith('activity.')) return { active: method !== 'activity.end' }
    if (protocol === 'moss.local-files/v1' && method === 'pick') return { paths: [input.kind === 'file' ? fileToPick : exportDir] }
    if (protocol === 'moss.artifacts/v1' && method === 'url.get') {
      return { url: pathToFileURL(path.join(dataDir, input.relativePath)).href }
    }
    throw new Error(`Unexpected Host service ${protocol}/${method}`)
  },
})
const invoke = (name, input = {}) => supervisor.invoke('studio', name, input, { timeoutMs: 180000, invocation: { surface: 'tool' } })
async function completed(get, label) {
  const deadline = Date.now() + 180000
  for (;;) {
    const task = await get()
    if (task.status === 'succeeded') return task
    assert(['queued', 'running', 'canceling'].includes(task.status), `${label}: ${task.message}\n${task.log || ''}`)
    assert(Date.now() < deadline, `${label}: ${task.message}`)
    await delay(200)
  }
}

try {
  supervisor.register({ key: 'studio', appId: manifest.id, version: manifest.version, instanceId: 'studio', generation: 1,
    packageRoot: app, entry: manifest.backend.entry, lifecycle: 'on-demand', protocols: manifest.host.protocols,
    permissions: manifest.permissions, dataDir, runtimeDir: path.join(temporary, 'runtime') })
  const tools = new Map(manifest.contributes.tools.map(tool => [tool.id, tool.action]))
  assert.equal(tools.size, 12)
  const tool = (id, input) => invoke(tools.get(id), input)
  const source = path.join(temporary, 'image.png')
  await sharp({ create: { width: 120, height: 80, channels: 3, background: '#287968' } }).png().toFile(source)
  const { files: [input] } = await tool('image_import', { paths: [source] })
  const image = await tool('image_process', { fileIds: [input.id], options: { width: 60, format: 'webp' } })
  const imageTask = await completed(async () => (await tool('image_get')).tasks.find(task => task.id === image.id), 'image')
  const { files: [output] } = await tool('image_export', { ids: imageTask.outputs })
  assert.equal((await sharp(output).metadata()).width, 60)
  assert.match((await invoke('image.files.preview', { id: imageTask.outputs[0] })).url, /^(data:image\/webp|file:)/)

  const summary = (await invoke('image.tasks.list')).tasks.find(task => task.id === imageTask.id)
  assert.deepEqual(summary.fileNames, ['image.png'])
  assert.equal(summary.results[0].id, imageTask.outputs[0])
  assert.equal(summary.results[0].name, 'image-1.webp')
  assert.equal(summary.input, undefined)
  const repeated = await invoke('image.tasks.retry', { id: imageTask.id })
  const retry = await completed(async () => (await tool('image_get')).tasks.find(task => task.id === repeated.id), 'image retry')
  assert.notEqual(retry.id, imageTask.id)
  assert.deepEqual(retry.input, imageTask.input)

  const settings = await tool('media_get', { type: 'settings' })
  const linux = process.platform === 'linux'
  const voice = linux ? settings.defaultVoice : (settings.voices.find(voice => voice.locale.startsWith('en_')) || settings.voices[0])?.name
  assert(voice, 'A local speech voice is available')
  if (linux) assert.equal(voice, 'Melo 中文')
  const script = linux ? '你好，欢迎使用多媒体工坊。' : 'Hello and welcome to the media studio.'
  const avatar = await tool('video_project_save', { kind: 'avatar', fields: { script, voice, quality: '480p' } })
  const speech = await tool('video_render', { id: avatar.id, version: avatar.version, output: 'speech' })
  assert(speech.duration > 0 && speech.cues.length > 0)
  const speechPath = fileURLToPath(speech.url)
  assert.equal((await fs.readFile(speechPath)).subarray(0, 4).toString(), 'RIFF')
  const job = async (id, label) => completed(() => tool('media_get', { type: 'task', id }), label)
  const info = await tool('media_edit', { mode: 'inspect', path: speechPath })
  const metadata = await job(info.id, 'ffprobe')
  assert(metadata.result.streams.some(stream => stream.codec_type === 'audio'))
  const wav = await tool('media_edit', { mode: 'audio', path: speechPath })
  assert(await fs.stat((await job(wav.id, 'ffmpeg')).artifacts[0].path))
  const transcribe = await tool('media_transcribe', { path: speechPath, language: linux ? 'zh' : 'en' })
  const transcript = await job(transcribe.id, 'Whisper')
  assert(transcript.artifacts.some(artifact => artifact.name.endsWith('.srt')))

  fileToPick = speechPath
  const audioAsset = await invoke('assets.import', { kind: 'audio' })
  const imported = await tool('video_project_save', { kind: 'avatar', fields: { source: 'audio', audioId: audioAsset.id } })
  const preview = await tool('video_render', { id: imported.id, version: imported.version, output: 'speech' })
  assert(preview.duration > 0)

  const animation = await tool('video_project_save', { kind: 'animation', animation: { name: '本地渲染', duration: 1.5, width: 320, height: 180 } })
  const render = await tool('video_render', { id: animation.id, version: animation.version, fps: 12, quality: 'fast' })
  const video = (await job(render.id, 'Chromium / HyperFrames')).artifacts.find(artifact => artifact.kind === 'video')
  assert.equal((await fs.readFile(video.path)).subarray(4, 8).toString(), 'ftyp')

  console.log(`Verified ${manifest.id} on ${process.platform}-${process.arch} using sharp, FFmpeg, Whisper, Chromium and both avatar audio sources`)
} catch (error) {
  if (logs.length) console.error(logs.slice(-20).join('\n'))
  throw error
} finally {
  await supervisor.shutdown()
  await fs.rm(temporary, { recursive: true, force: true })
}
