import fs from 'node:fs/promises'
import path from 'node:path'
import animation from '@moss/media-engines/animation'
import { snapshotRoot } from './workshop-engine.mjs'
import { serialQueue } from './projects.mjs'

export async function openAnimation(dataDir, backend) {
  const root = path.join(dataDir, 'animation')
  const actions = new Map()
  const serial = serialQueue()
  await animation.register({
    host: backend.host, registerAction: (name, fn) => actions.set(name, fn),
    emit: (...args) => backend.emit(...args),
  }, { dataDir: root })
  const call = (name, input, ctx) => actions.get(name)(input, ctx)
  const get = id => call('projects.get', { id })
  const view = p => ({ ...p, kind: 'animation', version: p.updatedAt,
    resourceUri: 'moss-media-studio-animation://project/' + p.id,
    presentation: { title: p.name, route: '#/animation/' + p.id } })
  async function current(id, version) {
    const p = await get(id)
    if (p.updatedAt !== version) throw new Error('分镜项目已更新，请重新读取最新版本')
    return p
  }
  return {
    get: id => serial(async () => view(await get(id))),
    projects: () => serial(() => call('projects.list', {})),
    templates: () => call('templates.list', {}),
    list: () => serial(async () => (await call('projects.list', {})).projects
      .map(({ id, name, updatedAt }) => ({ id, name, kind: 'animation', version: updatedAt }))
      .sort((a, b) => b.version - a.version)),
    validate: id => serial(() => call('projects.validate', { id })),
    save: input => serial(async () => {
      if (!input.id) return view(await call('projects.create', input.animation || {}))
      await current(input.id, input.version)
      const patch = input.storyboard ? ['projects.storyboard.save', { storyboard: input.storyboard }]
        : ['projects.scene.save', { sceneId: input.sceneId, html: input.html }]
      return view(await call(patch[0], { id: input.id, ...patch[1] }))
    }),
    importAssets: (input, ctx) => serial(async () => {
      const result = await call('assets.import', input, ctx)
      return result.canceled ? result : view(result)
    }),
    async resolve({ uri, ref, intent }) {
      if (uri) {
        const match = /^moss-media-studio-animation:\/\/project\/([a-zA-Z0-9_-]{1,64})$/.exec(uri)
        if (!match) throw new Error('无法识别分镜项目引用')
        return serial(async () => ({ ...await call('resources.resolve', { uri: 'moss-hyperframes://project/' + match[1] }), resourceUri: uri }))
      }
      const p = ref?.projectId ? await this.get(ref.projectId) : null
      if (!p && intent !== 'create') throw new Error('请选择分镜项目')
      return { title: p?.name || '分镜动画', ref: ref || {}, route: p?.presentation.route || '#/animation',
        prompt: [p ? '请继续编辑分镜项目 ' + p.id : '请创作' + (ref?.duration || 15) + '秒的' + (ref?.aspectRatio || '16:9') + '分镜动画。模板 ' + (ref?.templateId || 'product-intro'), ref?.prompt].filter(Boolean).join('\n'),
        tools: ['media_get', 'video_project_save', 'video_render'],
        instruction: '使用 kind=animation。先读取项目版本，保存分镜或场景后使用返回的新版本。每个镜头的 CSS 动画从该镜头的 0 秒计时。' }
    },
    snapshot: (id, version) => serial(async () => {
      const project = await current(id, version)
      await call('projects.validate', { id })
      const parent = path.join(snapshotRoot(dataDir, version), 'projects')
      const destination = path.join(parent, id)
      await fs.mkdir(parent, { recursive: true })
      if (await fs.stat(destination).catch(() => null)) return project.name
      const tmp = await fs.mkdtemp(path.join(parent, '.copy-'))
      try {
        await fs.cp(path.join(root, 'projects', id), tmp, { recursive: true })
        await fs.rename(tmp, destination)
      } finally { await fs.rm(tmp, { recursive: true, force: true }) }
      return project.name
    }),
  }
}
