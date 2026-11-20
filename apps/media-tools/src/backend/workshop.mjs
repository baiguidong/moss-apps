import path from 'node:path'
import { TaskStore } from '@moss/engine-apps/runtime'
import { saveTranscript } from '@moss/media-engines/transcript'
import { serialQueue } from './projects.mjs'
import { registerStudio } from './studio.mjs'
import { registerRecordings } from './recordings.mjs'
import { openAnimation } from './animation.mjs'

export async function registerWorkshop(backend, context, tasks) {
  const store = new TaskStore(context.dataDir)
  const animations = await openAnimation(context.dataDir, backend)
  const studio = new Map()
  const close = await registerStudio({
    agent: backend.agent, host: backend.host, emit: (...args) => backend.emit(...args),
    registerAction(name, fn) { studio.set(name, fn); backend.registerAction(name, fn) },
  }, context, tasks)
  const add = (name, handler) => backend.registerAction(name, handler)
  const start = (input, ctx) => tasks.startTask(input, ctx.source?.surface === 'tool' ? 'agent-tool' : 'ui', ctx.signal)
  const kindOf = id => id?.startsWith('project-') ? 'animation' : 'avatar'
  const getProject = id => kindOf(id) === 'animation' ? animations.get(id) : studio.get('projects.get')({ id })
  const listProjects = async () => {
    const [library, projects] = await Promise.all([studio.get('studio.get')(), animations.list()])
    return [...library.projects.map(p => ({ ...p, kind: 'avatar' })), ...projects]
  }
  add('media.transcribe', (input, ctx) => start({ mode: 'transcribe', ...input }, ctx))
  add('video.save', async input => {
    const kind = input.id ? kindOf(input.id) : input.kind
    if (input.kind && input.kind !== kind) throw new Error('项目类型与 ID 不符')
    if (!['avatar', 'animation'].includes(kind)) throw new Error('新项目需要 kind=avatar 或 animation')
    if (input.id && !Number.isSafeInteger(input.version)) throw new Error('修改项目需要当前版本')
    const fields = ['fields', 'animation', 'storyboard', 'sceneId', 'html'].filter(key => Object.hasOwn(input, key))
    const expected = kind === 'avatar' ? ['fields'] : !input.id ? ['animation']
      : input.storyboard ? ['storyboard'] : ['sceneId', 'html']
    if (fields.length !== expected.length || expected.some(key => !fields.includes(key))) throw new Error('请提供对应项目类型的字段')
    if (kind === 'animation') return animations.save(input)
    return studio.get(input.id ? 'projects.save' : 'projects.create')(input)
  })
  add('video.render', async (input, ctx) => {
    if (kindOf(input.id) === 'avatar') {
      if (input.fps !== undefined || input.quality !== undefined) throw new Error('口播使用项目保存的画质与帧率；fps 和 quality 仅用于分镜')
      return studio.get(input.output === 'speech' ? 'speech.prepare' : 'renders.submit')({ id: input.id, version: input.version }, ctx)
    }
    if (input.output === 'speech') throw new Error('配音试听仅用于口播项目')
    await animations.snapshot(input.id, input.version)
    return start({ mode: 'animation', projectId: input.id, version: input.version, fps: input.fps, quality: input.quality }, ctx)
  })
  add('media.get', async input => {
    if (['task', 'project', 'artifact', 'validate'].includes(input.type) && !input.id) throw new Error('查询此项需要 ID')
    if (input.type === 'artifact' && !Number.isInteger(input.index)) throw new Error('读取文本产物需要 index')
    switch (input.type) {
      case 'task': return tasks.details(input.id)
      case 'artifact': return tasks.readArtifact(input.id, input.index)
      case 'project': return getProject(input.id)
      case 'projects': return { projects: (await listProjects()).slice(input.offset || 0, (input.offset || 0) + (input.limit || 30)) }
      case 'settings': return studio.get('studio.get')()
      case 'validate': return animations.validate(input.id)
      case 'tasks': {
        const rows = await store.list({ offset: input.offset, limit: input.limit || 30 })
        return { tasks: rows
          .map(({ id, status, message, createdAt, input }) => ({ id, status, message, createdAt, mode: input.mode })) }
      }
      default: throw new Error('请选择查询类型')
    }
  })
  const serial = serialQueue()
  const save = input => serial(async () => {
    const task = await tasks.getTask(input.id)
    if (task.input.mode !== 'transcribe' || task.status !== 'succeeded') throw new Error('请选择已完成的转写任务')
    const transcript = await saveTranscript(path.join(store.directory(task.id), '逐字稿.json'), input)
    backend.emit('workspace.changed', {})
    return { revision: transcript.revision }
  })
  add('transcript.save', save)
  const closeRecordings = registerRecordings(backend, context, store, tasks, start, save)
  add('animation.projects.list', () => animations.projects())
  add('animation.templates.list', () => animations.templates())
  add('animation.assets', (input, ctx) => animations.importAssets(input, ctx))
  add('animation.list', async ({ query = '', offset = 0, limit = 20 }) => ({
    items: (await animations.list()).filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
      .slice(offset, offset + limit).map(p => ({ title: p.name, scope: 'user', ref: { projectId: p.id }, route: '#/animation/' + p.id })),
  }))
  add('animation.resolve', input => animations.resolve(input))
  return async () => { await closeRecordings(); await close() }
}
