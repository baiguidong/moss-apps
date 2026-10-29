import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Ajv from 'ajv'
import engine from '../src/backend/engine.mjs'
import { animationTimingWarnings } from '../src/backend/animation-timing.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-hyperframes-contract-'))
const actions = new Map()
await engine.register({ registerAction: (name, handler) => actions.set(name, handler) }, { dataDir: root })
const manifest = JSON.parse(await fs.readFile(new URL('../app.moss.json', import.meta.url)))
const outputSchemas = new Map()
const validator = new Ajv({ strict: false })
for (const action of manifest.backend.actions) {
  if (action.outputSchema) outputSchemas.set(action.name, validator.compile(JSON.parse(await fs.readFile(new URL(`../${action.outputSchema}`, import.meta.url)))))
}
const call = async (name, input = {}) => {
  const result = await actions.get(name)(input)
  const validate = outputSchemas.get(name)
  if (validate) assert.ok(validate(result), `${name}: ${JSON.stringify(validate.errors)}`)
  return result
}
test.after(() => fs.rm(root, { recursive: true, force: true }))

test('工具与 Manifest action 及独立对象 schema 对齐', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../app.moss.json', import.meta.url)))
  const shared = new Set(['tasks.start', 'tasks.get', 'tasks.cancel', 'artifacts.export', 'workspace.get'])
  const ajv = new Ajv({ strict: false })
  assert.equal(manifest.version, JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url))).version)
  assert.equal(manifest.contributes.tools.length, 11)
  for (const tool of manifest.contributes.tools) {
    const action = manifest.backend.actions.find(action => action.name === tool.action)
    assert.ok(action, tool.action)
    assert.equal(action.inputSchema, tool.inputSchema)
    assert.ok(actions.has(tool.action) || shared.has(tool.action), `${tool.action} 已注册`)
    const schema = JSON.parse(await fs.readFile(new URL(`../${tool.inputSchema}`, import.meta.url)))
    assert.equal(schema.type, 'object')
    assert.equal(schema.additionalProperties, false)
    ajv.compile(schema)
  }
  const resourceProvider = manifest.contributes.resourceProviders.find(item => item.id === 'video-projects')
  assert.deepEqual(resourceProvider.schemes, ['moss-hyperframes', 'moss'])
  assert.equal(resourceProvider.resolveAction, 'resources.resolve')
  assert.ok(actions.has(resourceProvider.resolveAction))
  assert.deepEqual(JSON.parse(await fs.readFile(new URL('../schemas/resource-resolve.json', import.meta.url))), {
    type: 'object', properties: { uri: { type: 'string', minLength: 1, maxLength: 8192 } },
    required: ['uri'], additionalProperties: false,
  })
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/render.json', import.meta.url)))
  const validate = ajv.compile(schema)
  assert.ok(validate({ operation: 'render', projectId: 'project-1' }))
  assert.equal(validate({ projectId: 'project-1', argv: ['--anything'] }), false)
})

test('四种离线模板、项目、分镜和场景真实持久化', async () => {
  assert.equal((await call('templates.list')).templates.length, 4)
  const project = await call('projects.create', { name: '中文教学', templateId: 'lesson', aspectRatio: '9:16', purpose: '理解分数', style: '简约', duration: 3 })
  assert.equal(project.width, 720)
  assert.equal(project.height, 1280)
  assert.equal(project.storyboard.scenes.length, 3)
  assert.match(project.scenes[0].html, /学习目标/)
  const storyboard = { scenes: [{ id: 'intro', title: '第一幕', duration: 1, narration: '中文旁白', visual: '标题卡片' }, { id: 'end', title: '结尾', duration: 1 }] }
  await call('projects.storyboard.save', { id: project.id, storyboard })
  const indexPath = path.join(root, 'projects', project.id, 'index.html')
  assert.doesNotMatch(await fs.readFile(indexPath, 'utf8'), /学习目标/)
  await assert.rejects(call('projects.validate', { id: project.id }), /尚未保存场景/)
  await call('projects.scene.save', { id: project.id, sceneId: 'intro', html: '<article>保存的第一幕</article>' })
  assert.match(await fs.readFile(indexPath, 'utf8'), /保存的第一幕/)
  await assert.rejects(call('projects.validate', { id: project.id }), /尚未保存场景/)
  await call('projects.scene.save', { id: project.id, sceneId: 'end', html: '<article>保存的结尾</article>' })
  const savedHtml = await fs.readFile(indexPath, 'utf8')
  assert.match(savedHtml, /保存的结尾/)
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'projects', project.id, 'project.json'), 'utf8')).html, savedHtml)
  const loaded = await call('projects.get', { id: project.id })
  assert.equal(loaded.duration, 2)
  assert.equal(loaded.storyboard.scenes[0].title, '第一幕')
  assert.equal(loaded.scenes[0].html, '<article>保存的第一幕</article>')
  assert.equal(loaded.html, savedHtml)
  // Reordering existing scenes must immediately update the composition too.
  await call('projects.storyboard.save', { id: project.id, storyboard: { scenes: [...storyboard.scenes].reverse() } })
  const reordered = await fs.readFile(indexPath, 'utf8')
  assert.ok(reordered.indexOf('保存的结尾') < reordered.indexOf('保存的第一幕'))
  const validation = await call('projects.validate', { id: project.id })
  assert.equal(validation.valid, true)
  const html = await fs.readFile(path.join(root, 'projects', project.id, 'index.html'), 'utf8')
  assert.match(html, /保存的第一幕/)
  assert.match(html, /data-duration="2"/)
  assert.ok((await call('projects.list')).projects.some(item => item.id === project.id))
})

test('拒绝穿越、任意命令、脚本、外链、无效分镜与尺寸', async () => {
  const project = await call('projects.create')
  await assert.rejects(call('projects.get', { id: '../escape' }), /ID 无效/)
  await assert.rejects(call('projects.create', { width: 12.5 }), /宽度无效/)
  await assert.rejects(call('projects.create', { templateId: 'unknown' }), /模板不存在/)
  await assert.rejects(engine.validate({ operation: 'render', projectId: project.id, argv: ['--help'] }), /请求参数无效/)
  await engine.validate({ operation: 'render', projectId: project.id })
  await engine.validate({ projectId: project.id })
  for (const html of ['<script>alert(1)</script>', '<img src="https://example.test/a.png">', '<div onclick="alert(1)">x</div>']) {
    await assert.rejects(call('projects.scene.save', { id: project.id, sceneId: 'scene-1', html }), /仅支持离线/)
  }
  await assert.rejects(call('projects.scene.save', { id: project.id, sceneId: '../escape', html: 'x' }), /分镜不存在/)
  await assert.rejects(call('projects.storyboard.save', { id: project.id, storyboard: { scenes: [{ id: 'a', title: 'a', duration: 1 }, { id: 'a', title: 'b', duration: 1 }] } }), /重复/)
})

test('旧版 HTML 项目可以读取与校验', async () => {
  const id = 'legacy-project', dir = path.join(root, 'projects', id)
  await fs.mkdir(dir)
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ id, name: '旧项目', width: 640, height: 360, duration: 1, html: '<!doctype html><p>旧中文项目</p>' }))
  assert.match((await call('projects.get', { id })).html, /旧中文项目/)
  assert.equal((await call('projects.validate', { id })).valid, true)
  assert.match(await fs.readFile(path.join(dir, 'index.html'), 'utf8'), /旧中文项目/)
})

test('资源 URI 解析返回项目预览文件并兼容旧协议', async () => {
  const project = await call('projects.create', { name: '资源预览测试', duration: 3 })
  const canonical = await call('resources.resolve', { uri: `moss-hyperframes://project/${project.id}` })
  assert.equal(canonical.kind, 'file')
  assert.equal(canonical.path, path.join(root, 'projects', project.id, 'index.html'))
  assert.equal(await fs.readFile(canonical.path, 'utf8'), project.html)
  const legacy = await call('resources.resolve', { uri: `moss://hyperframes/project/${project.id}` })
  assert.equal(legacy.path, canonical.path)
  await assert.rejects(call('resources.resolve', { uri: 'moss-hyperframes://project/bad%2Fid' }), /资源 URI 无效/)
  await assert.rejects(call('resources.resolve', { uri: `moss://other/project/${project.id}` }), /资源 URI 无效/)
})

test('保存和校验提醒场景内动画误用全片累计延迟', async () => {
  const project = await call('projects.create', { duration: 12 })
  const html = '<style>.users{animation:enter .7s 4s both, dots 1s 4200ms cubic-bezier(.2,.7,.2,1) both}</style><article class="users" style="animation-delay:4800ms">2,400</article>'
  const saved = await call('projects.scene.save', { id: project.id, sceneId: 'scene-2', html })
  assert.deepEqual(saved.warnings.map(warning => warning.delay), [4, 4.2, 4.8])
  assert.ok(saved.warnings.every(warning => warning.sceneId === 'scene-2' && warning.code === 'ANIMATION_DELAY_OUTSIDE_SCENE'))
  const result = await call('projects.validate', { id: project.id })
  assert.equal(result.valid, true) // Structural validity does not imply visible content.
  assert.deepEqual(result.warnings, saved.warnings)
  assert.match(result.message, /动画时间警告/)
  const corrected = html.replace(' .7s 4s ', ' .7s 0s ').replace('4200ms', '200ms').replace('4800ms', '800ms')
  assert.deepEqual((await call('projects.scene.save', { id: project.id, sceneId: 'scene-2', html: corrected })).warnings, [])
  assert.deepEqual((await call('projects.validate', { id: project.id })).warnings, [])
  const scene = { id: 'a', duration: 4 }
  assert.deepEqual(animationTimingWarnings('<article style="animation:enter 6s;animation-delay:-2s,.2s">局部动画</article>', scene), [])
  assert.deepEqual(animationTimingWarnings('<style>.a{animation:enter .7s var(--delay);animation-delay:calc(1s + 2s)}</style>', scene), [])
  assert.equal(animationTimingWarnings("<article style='-webkit-animation:enter .7s 4S both'>x</article>", scene).length, 1)
  assert.match((await call('composer.resolve', { intent: 'edit', ref: { projectId: project.id } })).instruction, /0 秒/)
})

test('主会话草稿携带真实项目、已声明工具和可返回的项目路由，不自动开始任务', async () => {
  const project = await call('projects.create', { name: '会话往返测试' })
  const manifest = JSON.parse(await fs.readFile(new URL('../app.moss.json', import.meta.url)))
  const composerView = manifest.contributes.views.find(view => view.id === 'moss-conversation')
  assert.ok(composerView)
  const result = await call('composer.resolve', { intent: 'edit', ref: { projectId: project.id, prompt: '修改开场' } })
  assert.equal(result.route, `#/projects/${project.id}`)
  assert.match(result.prompt, /修改开场/)
  assert.ok(result.prompt.includes(project.id))
  assert.ok(result.tools.every(id => manifest.contributes.tools.some(tool => tool.id === id)))
  const listing = await call('composer.list', { query: '会话往返', offset: 0, limit: 1 })
  assert.equal(listing.length, 1)
  assert.equal(listing[0].ref.projectId, project.id)
  assert.deepEqual(await call('composer.list', { query: '没有匹配的视频项目' }), [])
  assert.equal(outputSchemas.get('composer.list')({ projects: listing }), false)
  const draft = await call('composer.resolve', { intent: 'create', ref: { prompt: '科普短片', aspectRatio: '9:16', duration: 30, templateId: 'lesson' } })
  assert.match(draft.prompt, /30秒的9:16/)
  assert.equal(draft.route, '#/')
  await assert.rejects(call('composer.resolve', { intent: 'edit', ref: {} }), /选择视频项目/)
  await assert.rejects(call('composer.resolve', { intent: 'edit', ref: { projectId: '../escape' } }), /ID 无效/)
  await assert.rejects(call('composer.resolve', { intent: 'create', ref: { prompt: 'a'.repeat(4001) } }), /创作需求无效/)
  assert.equal(await fs.stat(path.join(root, 'jobs')).catch(() => null), null)
})

if (process.env.HYPERFRAMES_RENDER_TEST === '1') test('隔离安装包实际渲染 MP4', async () => { await import('./verify-render.mjs') })
