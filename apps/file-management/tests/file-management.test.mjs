import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { TaskStore } from '@moss/engine-apps/runtime'
import engine from '../src/backend/file-management.mjs'
import { importLegacyHistory } from '../src/backend/history.mjs'

test('both engines share task actions while backup credentials stay in backup workers', async () => {
  const actions = new Map(), submissions = []
  const context = { secrets: { password: 'saved in Moss' } }
  engine.register({ registerAction: (name, handler) => actions.set(name, handler) }, context, {
    startTask: (input, source) => { submissions.push({ input, source }); return { id: 'task' } },
  })
  const action = { source: { surface: 'tool' } }
  const scan = { command: 'dup', paths: ['/tmp'], options: { 'minimal-file-size': '1' } }
  assert.deepEqual(await actions.get('cleanup.scan')(scan, action), { id: 'task' })
  const cleanup = { ...scan, options: { 'delete-method': 'AEO' } }
  assert.throws(() => actions.get('cleanup.scan')(cleanup, action), /清理工具/)
  assert.throws(() => actions.get('cleanup.execute')(cleanup, action), /确认/)
  await actions.get('cleanup.execute')({ ...cleanup, confirmChanges: true }, action)
  assert.equal(submissions.length, 2)
  assert(submissions.every(task => task.source === 'agent-tool'))
  assert.deepEqual(engine.workerEnv(context, scan), { RESTIC_PASSWORD: '' })
  assert.deepEqual(engine.workerEnv(context, { command: 'backup' }), { RESTIC_PASSWORD: 'saved in Moss' })
  assert.doesNotThrow(() => engine.requireReady({}, scan))
  assert.throws(() => engine.requireReady({}, { command: 'backup' }), /备份密码/)
  const catalog = await actions.get('agent.catalog')({})
  assert(catalog.commands.includes('restore'))
  assert.deepEqual(catalog.cleanup.commands[0], { id: 'dup', title: '重复文件' })
  const details = await actions.get('agent.catalog')({ cleanupCommand: 'dup' })
  assert(details.command.options.some(option => option.key === 'search-method'))
})

test('video operations require the installed media studio provider', async () => {
  const handlers = new Map()
  let providers = []
  const backend = {
    registerAction: (name, handler) => handlers.set(name, handler),
    host: { request: async (protocol, method) => {
      assert.equal(protocol, 'moss.app-capabilities/v1')
      assert.equal(method, 'providers.list')
      return { providers }
    } },
  }
  engine.register(backend, {}, { startTask: () => ({ id: 'scan' }) })
  const request = { command: 'video', paths: ['/tmp'] }, action = { source: { surface: 'tool' } }
  const status = () => handlers.get('cleanup.video.status')({}, action)
  assert.match((await status()).message, /安装多媒体工坊.*moss\.media-studio/)
  await assert.rejects(handlers.get('cleanup.scan')(request, action), /安装多媒体工坊/)
  assert.equal((await handlers.get('agent.catalog')({ cleanupCommand: 'video' }, action)).videoDependency.available, false)
  providers = [{ appId: 'other.app', methods: ['video.get'], status: 'available', providerRef: 'unrelated' },
    { appId: 'moss.media-studio', methods: ['video.get'], status: 'disabled', providerRef: null }]
  assert.match((await status()).message, /启用多媒体工坊/)
  Object.assign(providers[1], { status: 'available', providerRef: 'studio' })
  assert.equal((await status()).available, true)
  assert.deepEqual(await handlers.get('cleanup.scan')(request, action), { id: 'scan' })
})

test('imports both legacy Apps while preserving job IDs, reports and source records', async () => {
  const owner = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-file-management-'))
  const store = id => new TaskStore(path.join(owner, id, 'instances', `${id}--default`))
  try {
    const cleaner = store('moss.file-cleaner'), backup = store('moss.backup'), current = store('moss.file-management')
    const oldScan = await cleaner.create({ command: 'dup', paths: [owner] }, 'agent-skill')
    const oldBackup = await backup.create({ command: 'backup', repo: path.join(owner, 'Restic repo'), paths: [owner] })
    const newTask = await current.create({ command: 'snapshots' })
    const reports = [[cleaner, oldScan, 'results.json', 'json'], [backup, oldBackup, '运行输出.txt', 'text']]
    for (const [legacy, task, name, kind] of reports) {
      const file = path.join(legacy.directory(task.id), name)
      await fs.writeFile(file, name)
      await legacy.write({ ...task, status: 'succeeded', artifacts: [{ name, path: file, kind }] })
    }
    await cleaner.create(oldScan.input)
    await fs.writeFile(path.join(backup.dataDir, 'private-config.json'), 'not part of task history')
    assert.deepEqual(await importLegacyHistory(current.dataDir), { imported: 2, existing: 0, active: 1, skipped: 0 })
    for (const [legacy, task, name] of reports) {
      const copied = await current.get(task.id)
      assert.equal(copied.status, 'succeeded')
      assert.deepEqual(copied.input, task.input)
      assert.equal(copied.artifacts[0].path, path.join(current.directory(task.id), name))
      assert.equal(await fs.readFile(copied.artifacts[0].path, 'utf8'), name)
      assert.equal(await fs.readFile(path.join(legacy.directory(task.id), name), 'utf8'), name)
    }
    await assert.rejects(fs.stat(path.join(current.dataDir, 'private-config.json')), { code: 'ENOENT' })
    assert.deepEqual(await current.get(newTask.id), newTask)
    assert.deepEqual(await importLegacyHistory(current.dataDir), { imported: 0, existing: 2, active: 1, skipped: 0 })
  } finally {
    await fs.rm(owner, { recursive: true, force: true })
  }
})
