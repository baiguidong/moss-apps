import { TaskStore } from '@moss/engine-apps/runtime'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createProjectStore, projectView, validateAvatar, validId, saveJson, readJson } from './projects.mjs'
import { createSpeech, voices } from './speech.mjs'
import { importStudio } from './history.mjs'
import { defaultVoice } from './linux-voice.mjs'
import { createTransfer } from './transfer.mjs'
import { createRenders } from './render.mjs'
import { createConversation } from './conversation.mjs'
import { createTranscriber } from './transcribe.mjs'

export async function registerStudio(backend, { dataDir, protocols = [] }, queue) {
  const root = path.join(dataDir, 'studio'),
    projects = createProjectStore(root)
  await projects.init()
  // Only immutable source assets and saved transcripts need to survive a restart.
  for (const name of await fs.readdir(path.join(root, 'assets'))) {
    if (name.endsWith('.webm')) await fs.rm(path.join(root, 'assets', name), { force: true })
  }
  for (const name of await fs.readdir(path.join(root, 'speech'))) {
    const dir = path.join(root, 'speech', name)
    if (name.includes('.') || Date.now() - (await fs.stat(dir)).mtimeMs > 7 * 86400000)
      await fs.rm(dir, { recursive: true, force: true })
  }
  const tasks = new TaskStore(dataDir)
  const transfer = await createTransfer(),
    speech = createSpeech(root, dataDir),
    transcriber = createTranscriber(queue)
  const emit = () => backend.emit('studio.changed', {})
  const renders = await createRenders({
    root,
    dataDir,
    transfer,
    changed: () => backend.emit('workspace.changed', {}),
  })
  const chat = createConversation(root, backend.host)
  const add = (name, fn) => backend.registerAction(name, fn)
  const versioned = async ({ id, version }) => {
    const project = await projects.get(id)
    if (project.version !== version) throw new Error('项目版本已更新，请重新载入')
    return project
  }
  async function assetUrl(file, type) {
    if (!protocols.includes('moss.artifacts/v1')) return transfer.read(file, type)
    const relativePath = path.relative(dataDir, file).split(path.sep).join('/')
    return (await backend.host.request('moss.artifacts/v1', 'url.get', { relativePath })).url
  }
  async function track(project, signal) {
    const { file, duration, cues } = await speech(project, signal)
    const captions =
      project.source === 'audio' && project.transcriptId
        ? (await readJson(path.join(root, 'assets', validId(project.transcriptId) + '.json'))).cues
        : cues
    return { url: await assetUrl(file, 'audio/wav'), duration, cues: captions }
  }
  add('studio.get', async () => ({
    ...(await projects.library()),
    projects: (await projects.list()).map((p) => ({ id: p.id, name: p.name, version: p.version })),
    voices: await voices(),
    defaultVoice,
    aspects: ['16:9', '9:16'],
    qualities: ['720p', '480p'],
  }))
  add('projects.create', async ({ fields }) => {
    const p = await projects.create(fields)
    emit()
    return projectView(p)
  })
  add('projects.get', async ({ id }) => projectView(await projects.get(id)))
  add('projects.save', async (input) => {
    const p = await projects.save(input)
    emit()
    return projectView(p)
  })
  add('assets.import', async ({ kind }, ctx) => {
    const { paths } = await backend.host.request(
      'moss.local-files/v1',
      'pick',
      { kind: 'file', multiple: false },
      { signal: ctx.signal },
    )
    if (!paths.length) return { canceled: true }
    const src = paths[0],
      stat = await fs.stat(src),
      avatar = kind === 'avatar',
      id = randomUUID(),
      name = path.basename(src)
    if (!stat.isFile() || stat.size > (avatar ? 64 : 256) * 1024 * 1024 || stat.size <= 0)
      throw new Error('角色最大 64 MiB，配音最大 256 MiB')
    const target = path.join(root, 'assets', id + (avatar ? '.glb' : '.audio'))
    try {
      await fs.copyFile(src, target)
      if (avatar) validateAvatar(await fs.readFile(target))
      else await speech({ source: 'audio', audioId: id }, ctx.signal)
      const item = { id, name: avatar ? path.parse(name).name : name }
      await projects.editLibrary((lib) => lib[avatar ? 'avatars' : 'audio'].push(item))
      emit()
      return item
    } catch (e) {
      await fs.rm(target, { force: true })
      throw e
    }
  })
  add('avatars.edit', async ({ id, name, makeDefault }) => {
    await projects.editLibrary((lib) => {
      const a = lib.avatars.find((a) => a.id === id)
      if (!a) throw new Error('角色不存在')
      if (name?.trim()) a.name = name.trim()
      if (makeDefault) lib.defaultAvatar = id
    })
    emit()
    return {}
  })
  add('avatars.get', async ({ id }) => {
    const lib = await projects.library()
    if (!lib.avatars.some((a) => a.id === id)) throw new Error('角色不存在')
    return {
      url:
        id === 'moss'
          ? './avatar.glb'
          : await assetUrl(path.join(root, 'assets', validId(id) + '.glb'), 'model/gltf-binary'),
    }
  })
  add('media.preview', async ({ id }) => {
    const task = await tasks.get(id)
    const file = task.artifacts[0]
    if (task.input.mode !== 'inspect' || task.status !== 'succeeded' || !file || !task.readRoots?.includes(file.path))
      throw new Error('请选择已读取的媒体文件')
    return { url: transfer.read(file.path, file.kind === 'audio' ? 'audio/' + path.extname(file.path).slice(1) : 'video/' + path.extname(file.path).slice(1)) }
  })
  add('audio.preview', async ({ id }, ctx) => {
    const lib = await projects.library()
    if (!lib.audio.some((a) => a.id === id)) throw new Error('配音文件不存在')
    return track({ source: 'audio', audioId: id }, ctx.signal)
  })
  add('speech.prepare', async (input, ctx) => track(await versioned(input), ctx.signal))
  add('speech.reply', async ({ text, voice, rate }, ctx) =>
    track({ source: 'script', script: text, voice, rate }, ctx.signal),
  )
  add('renders.submit', async (input, ctx) =>
    renders.submit(await versioned(input), ctx.source?.surface === 'tool' ? 'agent-tool' : 'ui'),
  )
  add('renders.retry', async ({ id }) => {
    const task = await tasks.get(id)
    if (task.input.mode !== '口播 MP4' || ['running', 'queued'].includes(task.status))
      throw new Error('不能重试当前任务')
    return renders.submit(task.input.project, 'ui')
  })
  add('renders.claim', renders.claim)
  add('renders.pulse', renders.pulse)
  add('renders.fail', renders.fail)
  add('renders.finish', renders.finish)
  add('renders.audio', async (input, ctx) => {
    renders.pulse(input)
    return track((await tasks.read(input.id)).input.project, ctx.signal)
  })
  for (const [name, handler] of Object.entries(chat)) add('chat.' + name, handler)
  for (const event of [
    'binding.changed',
    'turn.accepted',
    'turn.completed',
    'turn.failed',
    'turn.review_requested',
  ])
    backend.agent.on(event, () => {
      backend.emit('chat.changed', {})
      return { handled: true }
    })
  add('composer.list', async ({ query = '', offset = 0, limit = 20 }) => ({
    items: (await projects.list())
      .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
      .slice(offset, offset + limit)
      .map((p) => ({
        title: p.name,
        scope: 'user',
        ref: { projectId: p.id },
        route: projectView(p).presentation.route,
      })),
  }))
  add('resources.resolve', async ({ uri, intent, ref }) => {
    if (uri) {
      const m = /^moss-media-studio-avatar:\/\/projects\/([a-f0-9-]+)$/.exec(uri)
      if (!m) throw new Error('项目引用无效')
      const p = await projects.get(m[1])
      return { kind: 'file', name: p.name, path: projects.file(p.id), resourceUri: uri }
    }
    const p = ref?.projectId ? await projects.get(ref.projectId) : null
    if (!p && intent !== 'create') throw new Error('请选择口播项目')
    return {
      title: p?.name || '新建口播',
      route: p ? projectView(p).presentation.route : '#/',
      ref: ref || {},
      prompt: '请帮我创作适合朗读的中文讲稿。',
      tools: ['video_project_save', 'media_get', 'video_render'],
      instruction: p
        ? '通过 media_get 读取口播项目 ' + p.id + '，携带最新版本调用 video_project_save 保存。'
        : '调用 video_project_save 创建口播项目。用户要求出片时调用 video_render。',
    }
  })
  const mics = new Map()
  add('transcription.status', async () => ({ available: true }))
  add('mic.begin', async () => {
    for (const [id, m] of mics)
      if (Date.now() - m.at > 600_000) {
        transfer.revoke(m.upload.id)
        await fs.rm(m.file, { force: true })
        mics.delete(id)
      }
    const id = randomUUID(),
      file = path.join(root, 'assets', id + '.webm'),
      upload = transfer.write(file, 16 * 1024 * 1024)
    mics.set(id, { file, upload, at: Date.now() })
    return { id, url: upload.url }
  })
  add('mic.finish', async ({ id, discard }, ctx) => {
    const m = mics.get(id)
    if (!m) throw new Error('录音已过期')
    transfer.revoke(m.upload.id)
    mics.delete(id)
    try {
      return discard ? {} : await transcriber.read(m.file, ctx.signal)
    } finally {
      await fs.rm(m.file, { force: true })
    }
  })
  add('audio.transcribe', async (input, ctx) => {
    const p = await versioned(input)
    if (p.source !== 'audio' || !p.audioId) throw new Error('请选择配音文件')
    const { file } = await speech(p, ctx.signal),
      { cues } = await transcriber.read(file, ctx.signal),
      id = randomUUID()
    await saveJson(path.join(root, 'assets', id + '.json'), { audioId: p.audioId, cues })
    await projects.editLibrary((lib) => {
      ;(lib.transcripts ??= {})[id] = p.audioId
    })
    const saved = await projects.save({ ...input, fields: { transcriptId: id } })
    emit()
    return projectView(saved)
  })
  return {
    importHistory: (source, signal) => importStudio(path.join(source, 'studio'), root, projects, signal, chat),
    async close() {
      await renders.close()
      await transfer.close()
      await Promise.all([...mics.values()].map((m) => fs.rm(m.file, { force: true })))
    },
  }
}
