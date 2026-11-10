import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { AppProcessSupervisor } from '@moss/app-runtime'
import { scaffold } from '../resources/authoring/scaffold.mjs'

test('scaffold builds a backend without a UI, preserves existing files and runs text statistics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-scaffold-'))
  const supervisor = new AppProcessSupervisor({ nodeExecutable: 'node', processesDir: path.join(root, 'processes') })
  try {
    // Exercise the running SDK supplied to the scaffold, independently of a
    // source repository checkout. Moss normally creates these links through
    // its developer catalog export.
    const appsRepo = fileURLToPath(new URL('../../../', import.meta.url))
    const mossRepo = path.resolve(appsRepo, '../moss')
    const sdkRoot = await fs.access(path.join(appsRepo, '.moss-sdk/packages/app-sdk')).then(() => path.join(appsRepo, '.moss-sdk/packages')).catch(() => path.join(appsRepo, 'vendor/moss-core/packages'))
    const sdkSource = path.join(sdkRoot, 'app-sdk')
    const contractsSource = path.join(sdkRoot, 'host-contracts')
    await fs.mkdir(path.join(root, '.moss-sdk/packages'), { recursive: true })
    const sdkFilter = source => !source.split(path.sep).includes('node_modules')
    await fs.cp(sdkSource, path.join(root, '.moss-sdk/packages/app-sdk'), { recursive: true, filter: sdkFilter })
    await fs.cp(contractsSource, path.join(root, '.moss-sdk/packages/host-contracts'), { recursive: true, filter: sdkFilter })
    await fs.mkdir(path.join(root, '.moss-sdk/node_modules'), { recursive: true })
    const resolve = createRequire(path.join(mossRepo, 'package.json'))
    const copied = new Set()
    const copyDependency = async name => {
      if (copied.has(name)) return
      copied.add(name)
      let resolved
      try { resolved = resolve.resolve(`${name}/package.json`) } catch { resolved = resolve.resolve(name) }
      let packageRoot = path.dirname(resolved), metadata
      while (true) {
        metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
        if (metadata.name === name) break
        packageRoot = path.dirname(packageRoot)
      }
      const dependencyFilter = source => !path.relative(packageRoot, source).split(path.sep).includes('node_modules')
      await fs.cp(packageRoot, path.join(root, '.moss-sdk/node_modules', name), { recursive: true, dereference: true, filter: dependencyFilter })
      for (const dependency of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies })) await copyDependency(dependency)
    }
    for (const name of ['ajv', 'proper-lockfile', 'semver']) await copyDependency(name)
    await fs.mkdir(path.join(root, 'node_modules/@moss'), { recursive: true })
    await fs.symlink(path.join(root, '.moss-sdk/packages/app-sdk'), path.join(root, 'node_modules/@moss/app-sdk'), 'dir')
    await fs.symlink(path.join(root, '.moss-sdk/packages/host-contracts'), path.join(root, 'node_modules/@moss/host-contracts'), 'dir')
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
