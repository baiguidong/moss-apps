import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LocalTasks, atomicJson } from '@moss/local-tasks/backend'
import { TaskStore } from '@moss/engine-apps/runtime'
import { createProjectStore } from '../src/backend/projects.mjs'
import { importHistory, importStudio, importWorkspace } from '../src/backend/history.mjs'

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-history-')))
  const source = path.join(directory, 'old'), destination = path.join(directory, 'new')
  await Promise.all([fs.mkdir(source), fs.mkdir(destination)])
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { source, destination }
}

test('picture migration preserves IDs, previews and completed files through a restart', async t => {
  const { source, destination } = await fixture(t)
  const id = randomUUID(), taskId = randomUUID(), output = randomUUID()
  const relative = `files/${id}/原图.tiff`, previewRelative = `files/${id}/原图.png`
  const result = `tasks/${taskId}/结果.webp`
  for (const [name, content] of [[relative, 'original'], [previewRelative, 'preview'], [result, 'result']]) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true })
    await fs.writeFile(path.join(source, name), content)
  }
  await atomicJson(path.join(source, 'workspace.json'), {
    version: 1,
    files: [
      { id, name: '原图.tiff', role: 'input', relative, previewRelative, kind: 'image', metadata: {} },
      { id: output, name: '结果.webp', role: 'output', taskId, relative: result, kind: 'image', metadata: {} },
    ],
    tasks: [{ id: taskId, status: 'succeeded', outputs: [output], input: { fileIds: [id] } },
      { id: randomUUID(), status: 'running', outputs: [], input: { fileIds: [id] } }],
  })
  const options = { dataDir: path.join(destination, 'images'), artifactUrl: async relative => relative }
  const service = await new LocalTasks(options).initialize()
  try {
    assert.match((await importHistory(source, destination, { images: () => service })).summary, /2 个图片文件、2 条/)
    assert.deepEqual(await importWorkspace(source, service), { files: 0, tasks: 0 })
  } finally { await service.close() }
  const reopened = await new LocalTasks(options).initialize()
  try {
    const view = await reopened.overview()
    assert.equal(view.files.find(file => file.id === id).previewUrl, previewRelative)
    assert.equal(view.tasks.find(task => task.id === taskId).status, 'succeeded')
    assert(view.tasks.some(task => task.status === 'interrupted'))
    assert.equal(await fs.readFile(await reopened.filePath(reopened.file(output)), 'utf8'), 'result')
  } finally { await reopened.close() }
})

test('media migration rebases output and source paths while leaving external references inaccessible', async t => {
  const { source, destination } = await fixture(t)
  const oldProjects = createProjectStore(path.join(source, 'studio'))
  const projects = createProjectStore(path.join(destination, 'studio'))
  await Promise.all([oldProjects.init(), projects.init()])
  const saved = await oldProjects.create({ script: '旧讲稿' })
  const oldStore = new TaskStore(source)
  const task = await oldStore.create({ mode: 'transcribe', path: path.join(source, 'recordings', 'source.wav') })
  const output = path.join(oldStore.directory(task.id), '字幕.srt')
  await fs.writeFile(output, '字幕')
  await oldStore.write({
    ...task, status: 'succeeded', pid: 999, readRoots: [source],
    artifacts: [{ name: '字幕.srt', path: output }, { name: '外部.wav', path: '/root/private.wav' }],
  })
  const services = { studio: (root, signal) => importStudio(path.join(root, 'studio'), path.join(destination, 'studio'), projects, signal) }
  assert.match((await importHistory(source, destination, services)).summary, /1 条媒体任务、1 个口播项目.*1 个产物/)
  const copy = await new TaskStore(destination).read(task.id)
  assert.equal(copy.input.path, path.join(destination, 'recordings', 'source.wav'))
  assert.equal(await fs.readFile(copy.artifacts[0].path, 'utf8'), '字幕')
  assert(copy.artifacts[1].path.startsWith(path.join(destination, 'jobs', task.id) + path.sep))
  assert.equal(copy.readRoots, undefined)
  assert.equal(copy.pid, undefined)
  assert.equal((await projects.get(saved.id)).script, '旧讲稿')
  assert.match((await importHistory(source, destination, services)).summary, /0 条媒体任务、0 个口播项目/)
})

test('history import rejects a symlink and does not publish a partial workspace', async t => {
  const { source, destination } = await fixture(t)
  const id = randomUUID()
  const relative = `files/${id}/outside.png`
  await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true })
  await fs.symlink('/etc/passwd', path.join(source, relative))
  await atomicJson(path.join(source, 'workspace.json'), { version: 1, tasks: [], files: [{ id, relative, role: 'input' }] })
  const service = await new LocalTasks({ dataDir: destination, artifactUrl: async relative => relative }).initialize()
  try {
    await assert.rejects(importWorkspace(source, service), /符号链接/)
    assert.equal(service.state.files.length, 0)
  } finally { await service.close() }
})
