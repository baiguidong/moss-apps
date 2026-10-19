import { test, expect } from 'bun:test'
import { listApps, readJson } from './lib.mjs'
import { validateAppManifest } from '@moss/app-sdk'
import { validateAppPackage } from '../vendor/moss-core/packages/app-runtime/src/packages/index.mjs'
import { readConnectorAppPackage } from '../vendor/moss-core/packages/app-runtime/src/packages/connector-app.mjs'
import { exportAppSource, parseLock } from './source-package.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

test('all 114 service sources use short App identities with matching payloads', async () => {
  const apps = listApps().filter(app => app.manifest.connectorApp)
  expect(apps).toHaveLength(114)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'service-packages-'))
  try {
    for (const app of apps) {
      const name = app.manifest.connectorApp.id === 'feishu' ? 'feishu-cli' : app.manifest.connectorApp.id
      expect(path.basename(app.root)).toBe(name)
      expect(app.manifest.id).toBe(`moss.${name}`)
      expect(app.marketplace.appId).toBe(app.manifest.id)
      expect(app.marketplace.homepage).toEndWith(`/apps/${name}`)
      const packageJson = readJson(path.join(app.root, 'package.json'))
      expect(packageJson.name).toBe(`@moss/${name}`)
      expect(app.manifest.discovery.group).toBe('online')
      expect(app.manifest.navigation.location).toBe('none')
      expect(app.manifest.backend).toBeUndefined()
      expect(app.manifest.ui).toBeUndefined()
      const packageRoot = path.join(root, name)
      await fs.mkdir(packageRoot)
      for (const entry of ['app.moss.json', 'connector', 'assets', 'README.md']) {
        await fs.cp(path.join(app.root, entry), path.join(packageRoot, entry), { recursive: true })
      }
      const pkg = await validateAppPackage(packageRoot, { requireChecksums: false })
      expect(pkg.manifest.connectorApp).toEqual(app.manifest.connectorApp)
      expect(packageJson.scripts.build).toContain('connector-app-build')
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
  expect(apps.find(app => app.manifest.id === 'moss.feishu-cli')?.manifest.discovery.authMethods).toEqual(['browser'])
  expect(apps.find(app => app.manifest.id === 'moss.tencent-map')?.manifest.discovery.authMethods).toEqual(['api-key'])
  expect(listApps().find(app => app.manifest.id === 'moss.feishu')?.manifest.connectorApp).toBeUndefined()
}, 60000)

test('service metadata identity is explicit and independent of App ID', async () => {
  const app = listApps().find(app => app.manifest.id === 'moss.feishu-cli')!
  const manifest = validateAppManifest({ ...app.manifest, id: 'example.team-chat' })
  expect(manifest.id).toBe('example.team-chat')
  expect(manifest.connectorApp.id).toBe('feishu')
  const pkg = await readConnectorAppPackage(app.root, manifest)
  expect(pkg.metadata.id).toBe('feishu')
  await expect(readConnectorAppPackage(app.root, {
    ...manifest, connectorApp: { ...manifest.connectorApp, id: 'dingtalk' },
  })).rejects.toThrow('identity mismatch')
})

test('short service identities retain manifest and permission validation', () => {
  const app = listApps().find(app => app.manifest.id === 'moss.dingtalk')!
  expect(() => validateAppManifest({ ...app.manifest, id: 'invalid/app' })).toThrow('Invalid app.moss.json')
  expect(() => validateAppManifest({ ...app.manifest, permissions: [] })).toThrow('connector:use')
  expect(() => validateAppManifest({ ...app.manifest, permissions: ['connector:use', 'platform:files'] })).toThrow('connector:use')
  expect(() => validateAppManifest({ ...app.manifest, hostApi: '^3.14.0' })).toThrow('hostApi >=3.15.0')
  expect(() => validateAppManifest({ ...app.manifest, navigation: { location: 'more' } })).toThrow('Connector Apps require')
})

test('source export preserves short service workspace identities', async () => {
  const app = listApps().find(app => app.manifest.id === 'moss.feishu-cli')!
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'service-source-'))
  try {
    const spec = await exportAppSource(app, root)
    expect(spec.appRoot).toBe('apps/feishu-cli')
    expect(readJson(path.join(root, spec.appRoot, 'app.moss.json')).id).toBe('moss.feishu-cli')
    const lock = parseLock(await fs.readFile(path.join(root, 'bun.lock'), 'utf8'))
    expect(lock.workspaces['apps/feishu-cli'].name).toBe('@moss/feishu-cli')
    expect(lock.packages['@moss/feishu-cli']).toEqual(['@moss/feishu-cli@workspace:apps/feishu-cli'])
    expect(lock.packages['@moss/connector-app-build']).toEqual(['@moss/connector-app-build@workspace:packages/connector-app-build'])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('market catalog includes published connector Apps and preserves existing App cards', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'connector-catalog-'))
  try {
    const records = path.join(root, 'releases'), site = path.join(root, 'site')
    await fs.mkdir(records)
    for (const [id, displayName] of [['moss.tencent-map', '腾讯地图'], ['moss.trace', '原有调用追踪卡片']]) {
      await fs.writeFile(path.join(records, `${id}.release.json`), JSON.stringify({ schemaVersion: 1,
        app: { id, displayName, summary: 'Preserved summary', publisher: { id: 'moss', name: 'Moss' } },
        version: { version: '0.1.0', hostApi: '^3.15.0', permissions: [], platforms: ['darwin-arm64'], artifact: { downloadUrl: 'https://example.invalid/app.zip', sha256: 'a'.repeat(64) } } }))
    }
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--artifacts', records, '--output', site], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const apps = readJson(path.join(site, 'v1/index.json')).apps
    expect(apps).toHaveLength(2)
    expect(apps.find(app => app.id === 'moss.tencent-map').discovery).toEqual({ group: 'online', authMethods: ['api-key'] })
    expect(apps.find(app => app.id === 'moss.trace').displayName).toBe('原有调用追踪卡片')
    expect(apps.find(app => app.id === 'moss.trace').summary).toBe('Preserved summary')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
