import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppProcessSupervisor } from '@moss/app-runtime'
import { scaffold } from '../resources/authoring/scaffold.mjs'

test('scaffold builds a backend without a UI, preserves existing files and runs text statistics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-scaffold-'))
  const supervisor = new AppProcessSupervisor({ nodeExecutable: 'node', processesDir: path.join(root, 'processes') })
  try {
    // Exercise the running SDK supplied to the scaffold, independently of a Core checkout.
    const sdk = path.join(root, '.moss-sdk/packages/app-sdk/src')
    await fs.mkdir(sdk, { recursive: true })
    await fs.writeFile(path.join(sdk, 'index.mjs'), `export * from ${JSON.stringify(import.meta.resolve('@moss/app-sdk'))}\n`)
    const result = await scaffold({ dest: root, id: 'test.statistics', name: '文本统计测试' })
    assert.ok(result.files.includes('package-lock.json'))
    await assert.rejects(scaffold({ dest: root, id: 'test.statistics', name: '覆盖' }), /overwrite/)
    await promisify(execFile)('node', ['build.mjs'], { cwd: root })
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'app.moss.json')))
    assert.equal(manifest.ui, undefined)
    supervisor.register({ key: 'scaffold', appId: manifest.id, instanceId: 'test', version: manifest.version, generation: 1,
      packageRoot: root, entry: manifest.backend.entry, lifecycle: 'on-demand',
      dataDir: path.join(root, 'data'), runtimeDir: path.join(root, 'runtime') })
    assert.deepEqual(await supervisor.invoke('scaffold', 'text_stats', { text: '你好🌳\r\nMoss' }), { characters: 9, lines: 2 })
    assert.deepEqual(await supervisor.invoke('scaffold', 'text_stats', { text: '' }), { characters: 0, lines: 0 })
    await assert.rejects(supervisor.invoke('scaffold', 'text_stats', { text: 42 }), /text must be a string/)
  } finally {
    await supervisor.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30000)
