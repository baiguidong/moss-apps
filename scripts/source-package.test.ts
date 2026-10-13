import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { exportAppSource, focusedLock, parseLock } from './source-package.mjs'
import { selectApps } from './lib.mjs'

test('focused lock retains exact nested resolutions and excludes unrelated Apps', () => {
  const lock = { lockfileVersion: 1, configVersion: 1, packages: {
    dep: ['dep@2.0.0', '', {}, 'integrity-root'],
    '@moss/example/dep': ['dep@1.0.0', '', { dependencies: { child: '1.0.0' } }, 'integrity-pinned'],
    child: ['child@1.0.0', '', {}, 'integrity-child'],
    unrelated: ['unrelated@9.0.0', '', {}, 'unused'],
    '@moss/other': ['@moss/other@workspace:apps/other'],
  } }
  const result = focusedLock(lock, { '': { name: 'root' }, 'apps/example': { name: '@moss/example', dependencies: { dep: '1.0.0' } } })
  expect(result.packages['@moss/example/dep']).toEqual(lock.packages['@moss/example/dep'])
  expect(result.packages.child).toEqual(lock.packages.child)
  expect(result.packages.unrelated).toBeUndefined()
  expect(result.packages['@moss/other']).toBeUndefined()
  expect(result.packages.dep).toBeUndefined()
})

test('missing locked dependency fails instead of resolving latest', () => {
  expect(() => focusedLock({ packages: {} }, { '': { name: 'root', dependencies: { missing: '^1' } } })).toThrow('Lockfile dependency missing')
  expect(parseLock('{"lockfileVersion":1,"packages":{},}')).toEqual({ lockfileVersion: 1, packages: {} })
})

test('Builder source includes its declared Runtime build dependency and verifies the complete SDK snapshot', async () => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builder-source-test-'))
  try {
    const spec = await exportAppSource(selectApps(['--app', 'moss.app-builder'])[0], destination)
    const workspace = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'))
    expect(workspace.workspaces).toContain('vendor/moss-core/packages/app-runtime')
    const lock = parseLock(await fs.readFile(path.join(destination, 'bun.lock'), 'utf8'))
    expect(lock.packages['@moss/app-runtime']).toEqual(['@moss/app-runtime@workspace:vendor/moss-core/packages/app-runtime'])
    const output = execFileSync('node', ['scripts/sync-core-sdk.mjs', '--check'], { cwd: path.join(destination, spec.appRoot), encoding: 'utf8' })
    expect(output).toContain('SDK snapshot verified')
  } finally { await fs.rm(destination, { recursive: true, force: true }) }
})
