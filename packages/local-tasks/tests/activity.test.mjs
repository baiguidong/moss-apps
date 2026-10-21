import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalTasks } from '../src/backend.mjs'

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for task state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('activity renewals retry after a transient Host failure and end after in-flight renewal', async () => {
  const operations = [], logs = []
  let renewals = 0, releaseRenewal
  const service = new LocalTasks({
    dataDir: '.', worker: '', inspect: () => ({}), validate: () => ({}),
    activity: async operation => {
      operations.push(operation)
      if (operation === 'renew' && ++renewals === 1) throw new Error('Temporary Host failure')
      if (operation === 'renew' && renewals === 3) await new Promise(resolve => { releaseRenewal = resolve })
      return { active: operation !== 'end' }
    },
    onActivityLog: (level, message) => logs.push([level, message]),
  })
  await service.beginActivity('task-1')
  const lease = service.activityTimers.get('task-1')
  await service.renewActivity('task-1', lease)
  assert.equal(lease.failures, 1)
  assert.ok(logs.some(([level]) => level === 'warn'))
  await service.renewActivity('task-1', lease)
  assert.equal(lease.failures, 0)
  assert.ok(logs.some(([level]) => level === 'info'))
  const renewal = service.renewActivity('task-1', lease)
  await waitFor(() => Boolean(releaseRenewal))
  const ending = service.endActivity('task-1')
  assert.equal(operations.at(-1), 'renew')
  releaseRenewal()
  await Promise.all([renewal, ending])
  assert.deepEqual(operations, ['begin', 'renew', 'renew', 'renew', 'end'])
  assert.equal(service.activityTimers.size, 0)
})

test('persistent renewal failure stops an active worker before the Host lease expires', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-activity-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const worker = path.join(root, 'worker.cjs')
  await fs.writeFile(worker, "process.on('message', message => { if (message.type === 'run') process.send({ type: 'progress', progress: 1, message: 'working' }); if (message.type === 'cancel') process.send({ type: 'result', result: { canceled: true, files: [] } }) })")
  const operations = [], logs = []
  const service = await new LocalTasks({
    dataDir: path.join(root, 'data'), worker,
    inspect: () => ({}), validate: () => ({ fileIds: [], title: 'Long task' }),
    artifactUrl: async relative => `host://artifact/${relative}`,
    activity: async operation => {
      operations.push(operation)
      if (operation === 'renew') throw new Error('Host unavailable')
      return { active: operation !== 'end' }
    },
    onActivityLog: (level, message) => logs.push([level, message]),
  }).initialize()
  t.after(() => service.close())
  const task = await service.start({})
  await waitFor(() => service.state.tasks[0].status === 'running' && service.running?.child?.connected)
  const lease = service.activityTimers.get(task.id)
  lease.confirmedAt = Date.now() - 75_000
  await service.renewActivity(task.id, lease)
  await waitFor(() => service.state.tasks[0].status === 'failed' && operations.includes('end'))
  assert.match(service.state.tasks[0].message, /续约持续失败/)
  assert.deepEqual(operations, ['begin', 'renew', 'end'])
  assert.ok(logs.some(([level]) => level === 'error'))
  assert.equal(service.activityTimers.size, 0)
})

test('concurrent activity registration cannot exceed the task queue limit', async () => {
  let releaseBegins
  const beginGate = new Promise(resolve => { releaseBegins = resolve })
  const service = new LocalTasks({
    dataDir: '.', worker: '', inspect: () => ({}), validate: () => ({ fileIds: [] }),
    activity: async operation => {
      if (operation === 'begin') await beginGate
      return { active: operation !== 'end' }
    },
  })
  service.save = async () => {}
  service.pump = () => {}
  const starts = Array.from({ length: 10 }, () => service.start({}))
  await assert.rejects(service.start({}), /队列已满/)
  assert.equal(service.startReservations, 10)
  releaseBegins()
  const tasks = await Promise.all(starts)
  assert.equal(tasks.length, 10)
  assert.equal(service.state.tasks.length, 10)
  assert.equal(service.startReservations, 0)
  await Promise.all(tasks.map(task => service.endActivity(task.id)))
})

test('canceling while activity registration is pending does not enqueue a task', async () => {
  let releaseBegin
  const beginGate = new Promise(resolve => { releaseBegin = resolve })
  const operations = []
  const service = new LocalTasks({
    dataDir: '.', worker: '', inspect: () => ({}), validate: () => ({ fileIds: [] }),
    activity: async operation => {
      operations.push(operation)
      if (operation === 'begin') await beginGate
      return { active: operation !== 'end' }
    },
  })
  const controller = new AbortController()
  const starting = service.start({}, controller.signal)
  await waitFor(() => operations.includes('begin'))
  controller.abort(new Error('Canceled before acceptance'))
  releaseBegin()
  await assert.rejects(starting, /Canceled before acceptance/)
  assert.deepEqual(operations, ['begin', 'end'])
  assert.equal(service.state.tasks.length, 0)
  assert.equal(service.startReservations, 0)
  assert.equal(service.activityTimers.size, 0)
})

test('notification failure after saving does not discard an accepted task', async () => {
  const logs = []
  let pumped = false
  const service = new LocalTasks({
    dataDir: '.', worker: '', inspect: () => ({}), validate: () => ({ fileIds: [] }),
    onChanged: () => { throw new Error('Event transport closed') },
    onActivityLog: (level, message) => logs.push([level, message]),
  })
  service.save = async () => {}
  service.pump = () => { pumped = true }
  const task = await service.start({})
  assert.equal(service.state.tasks[0].id, task.id)
  assert.equal(pumped, true)
  assert.ok(logs.some(([level]) => level === 'warn'))
})

test('canceling during task persistence rolls back the queued task before any worker starts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-admission-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = await new LocalTasks({
    dataDir: root, worker: '', inspect: () => ({}), validate: () => ({ fileIds: [] }),
    artifactUrl: async relative => `host://artifact/${relative}`,
  }).initialize()
  t.after(() => service.close())
  const save = service.save.bind(service)
  let releaseSave, persisted
  const gate = new Promise(resolve => { releaseSave = resolve })
  const firstPersisted = new Promise(resolve => { persisted = resolve })
  let writes = 0
  service.save = async () => {
    await save()
    if (++writes === 1) { persisted(); await gate }
  }
  const controller = new AbortController()
  const starting = service.start({}, controller.signal)
  await firstPersisted
  service.pump()
  assert.equal(service.running, null)
  controller.abort(new Error('Canceled while saving'))
  releaseSave()
  await assert.rejects(starting, /Canceled while saving/)
  assert.equal(service.state.tasks.length, 0)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8')).tasks, [])
})

test('aborting an import during inspection leaves no imported file or task record', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-import-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source.txt')
  await fs.writeFile(source, 'hello')
  let releaseInspect, inspecting
  const gate = new Promise(resolve => { releaseInspect = resolve })
  const inspectStarted = new Promise(resolve => { inspecting = resolve })
  const service = await new LocalTasks({ dataDir: path.join(root, 'data'), worker: '', validate: () => ({}),
    inspect: async () => { inspecting(); await gate; return { kind: 'text' } },
    artifactUrl: async relative => `host://artifact/${relative}`,
  }).initialize()
  t.after(() => service.close())
  const controller = new AbortController()
  const importing = service.importFiles([source], controller.signal)
  await inspectStarted
  controller.abort(new Error('Canceled during inspection'))
  releaseInspect()
  await assert.rejects(importing, /Canceled during inspection/)
  assert.deepEqual(service.state.files, [])
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'data', 'workspace.json'), 'utf8')).files, [])
})

test('a failed status notification does not stop the next queued worker', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-notify-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const worker = path.join(root, 'worker.cjs')
  await fs.writeFile(worker, "process.on('message', message => { if (message.type === 'run') process.send({ type: 'result', result: { files: [] } }, () => process.exit(0)) })")
  const service = await new LocalTasks({ dataDir: path.join(root, 'data'), worker,
    inspect: () => ({}), validate: () => ({ fileIds: [] }),
    onChanged: () => { throw new Error('Event transport closed') },
  }).initialize()
  t.after(() => service.close())
  const first = await service.start({}), second = await service.start({})
  await waitFor(() => service.state.tasks.every(task => task.status === 'succeeded') && service.running === null)
  assert.deepEqual(service.state.tasks.map(task => task.id).sort(), [first.id, second.id].sort())
  assert.equal(service.running, null)
})

test('an invalid later worker output leaves no partial result in the workspace', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-output-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const worker = path.join(root, 'worker.cjs')
  await fs.writeFile(worker, `const fs = require('node:fs')
const path = require('node:path')
process.on('message', message => {
  if (message.type !== 'run') return
  const valid = path.join(message.outputDir, 'valid.txt')
  fs.writeFileSync(valid, 'valid')
  process.send({ type: 'result', result: { files: [
    { path: valid, name: 'valid.txt' },
    { path: path.join(message.outputDir, 'missing.txt'), name: 'missing.txt' },
  ] } }, () => process.exit(0))
})`)
  const service = await new LocalTasks({ dataDir: path.join(root, 'data'), worker,
    inspect: () => ({}), validate: () => ({ fileIds: [] }),
    artifactUrl: async relative => `host://artifact/${relative}`,
  }).initialize()
  t.after(() => service.close())
  const task = await service.start({})
  await waitFor(() => service.state.tasks[0].status === 'failed' && service.running === null)
  assert.equal(service.state.tasks[0].id, task.id)
  assert.deepEqual(service.state.tasks[0].outputs, [])
  assert.deepEqual(service.state.files, [])
  await assert.rejects(fs.stat(path.join(root, 'data', 'tasks', task.id)), { code: 'ENOENT' })
  const persisted = JSON.parse(await fs.readFile(path.join(root, 'data', 'workspace.json'), 'utf8'))
  assert.deepEqual(persisted.files, [])
})

test('shutdown waits for an unaccepted task to be rolled back on disk', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-close-admission-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = await new LocalTasks({ dataDir: root, worker: '', inspect: () => ({}),
    validate: () => ({ fileIds: [] }), artifactUrl: async relative => `host://artifact/${relative}` }).initialize()
  const save = service.save.bind(service)
  let releaseSave, persisted
  const gate = new Promise(resolve => { releaseSave = resolve })
  const firstPersisted = new Promise(resolve => { persisted = resolve })
  let writes = 0
  service.save = async () => {
    await save()
    if (++writes === 1) { persisted(); await gate }
  }
  const starting = service.start({})
  await firstPersisted
  let closed = false
  const closing = service.close().then(() => { closed = true })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(closed, false)
  releaseSave()
  await assert.rejects(starting, /正在关闭/)
  await closing
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8')).tasks, [])
})

test('shutdown waits for an in-flight batch import to persist completed files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-close-import-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const first = path.join(root, 'first.txt'), second = path.join(root, 'second.txt')
  await Promise.all([fs.writeFile(first, 'first'), fs.writeFile(second, 'second')])
  let releaseInspect, inspecting
  const gate = new Promise(resolve => { releaseInspect = resolve })
  const secondInspect = new Promise(resolve => { inspecting = resolve })
  let calls = 0
  const dataDir = path.join(root, 'data')
  const service = await new LocalTasks({ dataDir, worker: '', validate: () => ({}),
    inspect: async () => { if (++calls === 2) { inspecting(); await gate } return { kind: 'text' } },
    artifactUrl: async relative => `host://artifact/${relative}`,
  }).initialize()
  const importing = service.importFiles([first, second])
  await secondInspect
  let closed = false
  const closing = service.close().then(() => { closed = true })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(closed, false)
  releaseInspect()
  await assert.rejects(importing, /正在关闭/)
  await closing
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'workspace.json'), 'utf8'))
  assert.equal(persisted.files.length, 1)
  assert.equal(persisted.files[0].name, 'first.txt')
})

test('a missing artifact does not hide other files and task history', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-artifact-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'good.txt'), 'good')
  const service = await new LocalTasks({ dataDir: root, worker: '', inspect: () => ({}), validate: () => ({}),
    artifactUrl: async relative => { await fs.realpath(path.join(root, relative)); return `host://artifact/${relative}` },
  }).initialize()
  t.after(() => service.close())
  service.state.files = [
    { id: 'good', name: 'good.txt', relative: 'good.txt', role: 'input' },
    { id: 'missing', name: 'missing.txt', relative: 'missing.txt', role: 'input' },
  ]
  service.state.tasks = [{ id: 'history', status: 'succeeded', outputs: ['good'] }]
  const result = await service.overview()
  assert.deepEqual(result.files.map(file => file.id), ['good'])
  assert.deepEqual(result.unavailableFiles, [{ id: 'missing', name: 'missing.txt' }])
  assert.deepEqual(result.tasks.map(task => task.id), ['history'])
})

test('a missing optional preview does not hide its original file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-preview-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'good.png'), 'good')
  const service = await new LocalTasks({ dataDir: root, worker: '', inspect: () => ({}), validate: () => ({}),
    artifactUrl: async relative => { await fs.realpath(path.join(root, relative)); return `host://artifact/${relative}` },
  }).initialize()
  t.after(() => service.close())
  service.state.files = [{ id: 'good', name: 'good.png', relative: 'good.png', previewRelative: 'missing.png', role: 'input' }]
  const result = await service.overview()
  assert.deepEqual(result.files.map(file => file.id), ['good'])
  assert.equal(result.files[0].url, 'host://artifact/good.png')
  assert.equal(result.files[0].previewUrl, undefined)
  assert.deepEqual(result.unavailableFiles, [])
})

test('missing optional thumbnails do not discard imported files or completed outputs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-optional-preview-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source.txt'), worker = path.join(root, 'worker.cjs')
  await fs.writeFile(source, 'source')
  await fs.writeFile(worker, `const fs = require('node:fs')
const path = require('node:path')
process.on('message', message => {
  if (message.type !== 'run') return
  const output = path.join(message.outputDir, 'output.txt')
  fs.writeFileSync(output, 'output')
  process.send({ type: 'result', result: { files: [
    { path: output, name: 'output.txt', previewPath: path.join(message.outputDir, 'missing.png') },
  ] } }, () => process.exit(0))
})`)
  const service = await new LocalTasks({ dataDir: path.join(root, 'data'), worker,
    inspect: async file => ({ kind: 'image', previewPath: `${file}.missing.png` }),
    validate: input => ({ fileIds: input.fileIds }),
    artifactUrl: async relative => `host://artifact/${relative}`,
  }).initialize()
  t.after(() => service.close())
  const imported = await service.importFiles([source])
  assert.equal(imported.files.length, 1)
  assert.deepEqual(imported.errors, [])
  assert.equal(imported.files[0].previewUrl, undefined)
  const task = await service.start({ fileIds: [imported.files[0].id] })
  await waitFor(() => service.state.tasks[0].status === 'succeeded' && service.running === null)
  const output = (await service.overview()).files.find(file => file.taskId === task.id)
  assert.equal(output.name, 'output.txt')
  assert.equal(output.previewUrl, undefined)
  assert.equal(service.state.tasks[0].outputs.length, 1)
  service.inspect = async () => ({ kind: 'image', previewPath: path.join(root, 'outside-missing.png') })
  const outside = await service.importFiles([source])
  assert.equal(outside.files.length, 0)
  assert.match(outside.errors[0].message, /文件不属于当前 App/)
})

test('a Host artifact outage does not replace a populated workspace with an empty one', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-task-host-outage-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = await new LocalTasks({ dataDir: root, worker: '', inspect: () => ({}), validate: () => ({}),
    artifactUrl: async () => { throw new Error('Host artifact service unavailable') },
  }).initialize()
  t.after(() => service.close())
  service.state.files = [{ id: 'one', name: 'one.png', relative: 'one.png', role: 'input' }]
  await assert.rejects(service.overview(), /Host artifact service unavailable/)
  assert.equal(service.state.files.length, 1)
})

test('failed activity acknowledgement cleans up a Host registration', async () => {
  const operations = []
  let hostActive = false
  const service = new LocalTasks({ dataDir: '.', worker: '', inspect: () => ({}), validate: () => ({ fileIds: [] }),
    activity: async operation => {
      operations.push(operation)
      if (operation === 'begin') { hostActive = true; throw new Error('Reply lost') }
      if (operation === 'end') hostActive = false
      return { active: hostActive }
    },
  })
  await assert.rejects(service.start({}), /Reply lost/)
  assert.deepEqual(operations, ['begin', 'end'])
  assert.equal(hostActive, false)
  assert.equal(service.state.tasks.length, 0)
})
