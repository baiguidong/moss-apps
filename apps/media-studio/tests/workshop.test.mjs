import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerWorkshop } from '../src/backend/workshop.mjs'
import { snapshotRoot } from '../src/backend/workshop-engine.mjs'

test('the media session tools resolve both project kinds and render the exact saved revision', async t => {
  const manifest = JSON.parse(await fs.readFile(new URL('../app.moss.json', import.meta.url)))
  assert.equal(manifest.toolScope, 'session')
  assert.equal(manifest.backend.lifecycle, 'on-demand')
  assert.deepEqual(manifest.contributes.tools.map(t => t.id),
    ['media_edit', 'media_transcribe', 'video_project_save', 'video_render', 'media_get', 'media_cancel', 'media_export',
      'image_import', 'image_get', 'image_process', 'image_cancel', 'image_export'])
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-contract-'))
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }))
  const actions = new Map(), starts = []
  const backend = { host: {}, agent: { on() {} }, emit() {}, registerAction(name, fn) { actions.set(name, fn) } }
  const queue = { startTask(input) { starts.push(input); return { id: 'job' } } }
  const close = await registerWorkshop(backend, { dataDir }, queue)
  t.after(close)
  const ctx = { signal: new AbortController().signal, source: { surface: 'tool' } }
  const call = (name, input) => actions.get(name)(input,ctx)
  const avatar = await call('video.save', { kind: 'avatar', fields: { name: '口播', script: '欢迎来到工坊。' } })
  assert.match(avatar.resourceUri, /^moss-media-studio-avatar:/)
  assert.equal((await call('media.get', { type: 'project', id: avatar.id })).version, 1)
  for (const input of [{}, {kind:'avatar', animation:{}}, {kind:'animation', fields:{}}])
    await assert.rejects(call('video.save', input))
  const project = await call('video.save', { kind:'animation', animation:{ name:'产品演示', duration:3 } })
  assert.match(project.resourceUri, /^moss-media-studio-animation:/)
  const shot = project.storyboard.scenes[0]
  const update = html => ({ id:project.id, version:project.version, sceneId:shot.id, html })
  await call('video.render', { id:project.id, version:project.version })
  const next = await call('video.save', update('<p>新镜头</p>'))
  assert.ok(next.version > project.version)
  await assert.rejects(call('video.save', update('<p>过期</p>')), /版本/)
  const fixed = path.join(snapshotRoot(dataDir, starts[0].version), 'projects', project.id)
  assert.equal(await fs.readFile(path.join(fixed, 'scenes', shot.id + '.html'), 'utf8'), project.scenes[0].html)
  assert.deepEqual((await call('animation.list', {})).items[0].ref, {projectId:project.id})
  const draft = await call('animation.resolve', { intent:'create', ref:{ prompt:'中文动画', duration:30, aspectRatio:'9:16' } })
  assert.match(draft.prompt, /中文动画/)
  assert.ok(draft.tools.every(id => manifest.contributes.tools.some(t => t.id === id)))
  await call('media.transcribe', { path:'/tmp/录音.mp3', language:'zh' })
  assert.equal(starts.at(-1).mode, 'transcribe')
})
