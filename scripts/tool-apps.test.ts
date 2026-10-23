import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { listApps, selectApps, repoRoot } from './lib.mjs'
import { exportAppSource, parseLock } from './source-package.mjs'

test('discovers application projects and declarative tools with their own resource locations', () => {
  const apps = listApps()
  expect(apps.filter(app => app.kind === 'tool')).toHaveLength(121)
  expect(apps.filter(app => app.kind === 'app').every(app => !app.manifest.connectorApp && !app.manifest.mcpApp)).toBe(true)
  expect(apps.find(app => app.manifest.id === 'moss.git')?.kind).toBe('tool')
  const drawio = apps.find(app => app.manifest.id === 'moss.drawio')!
  expect(drawio.kind).toBe('tool')
  expect(drawio.resourceRoot).toBe(path.join(repoRoot, 'tool-apps/drawio/resources'))
  expect(drawio.manifest.publisher?.id).toBe('moss')
  const thinking = apps.find(app => app.manifest.id === 'moss.sequential-thinking')!
  expect(thinking.kind).toBe('tool')
  expect(thinking.resourceRoot).toBe(path.join(repoRoot, 'tool-apps/sequential-thinking/resources'))
  expect(thinking.manifest.backend).toBeUndefined()
  const dbx = apps.find(app => app.manifest.id === 'moss.dbx')!
  expect(dbx.kind).toBe('tool')
  expect(dbx.manifest.ui.builtin).toBe('mcp')
  expect(dbx.manifest.navigation?.location).toBe('settings')
  expect(dbx.manifest.backend).toBeUndefined()
  expect(dbx.manifest.mcpApp?.runtime?.state).toBe('session')
})
test('invalid source is reported separately; duplicate identities remain fatal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-discovery-'))
  const input = JSON.parse(await fs.readFile(path.join(repoRoot, 'tool-apps/drawio/app.json'), 'utf8'))
  delete input.icon
  try {
    const appRoot = path.join(root, 'tool-apps/example')
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.join(appRoot, 'app.json'), JSON.stringify(input))
    const errors: any[] = []
    expect(listApps({ root, onError: error => errors.push(error) })).toEqual([])
    expect(errors[0].error).toContain('marketplace')
    const duplicate = path.join(root, 'apps/duplicate')
    await fs.mkdir(duplicate, { recursive: true })
    await fs.writeFile(path.join(duplicate, 'app.moss.json'), JSON.stringify({ id: input.id }))
    expect(() => listApps({ root, onError: () => {} })).toThrow('Duplicate App id')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test.each(['drawio', 'sequential-thinking', 'filesystem', 'git', 'markitdown', 'excel', 'dbx'])('%s source contains its shared generator and a focused locked workspace', async directory => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-config-source-'))
  try {
    const app = selectApps(['--app', `moss.${directory}`])[0]
    const spec = await exportAppSource(app, root)
    expect(spec.appRoot).toBe(`tool-apps/${directory}`)
    const pkg = JSON.parse(await fs.readFile(path.join(root, spec.appRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts.build).toBe('node ../../scripts/build-tool-app.mjs')
    expect(await fs.readFile(path.join(root, 'scripts/build-tool-app.mjs'), 'utf8')).toContain('generateToolApp')
    expect(await fs.readFile(path.join(root, 'scripts/npm-command.mjs'), 'utf8')).toContain('npm-cli.js')
    const lock = parseLock(await fs.readFile(path.join(root, 'bun.lock'), 'utf8'))
    expect(lock.packages['@moss/app-runtime']).toBeDefined()
    expect(lock.packages['@moss/git-app']).toBeUndefined()
    expect(lock.packages['@moss/sequential-thinking-app']).toBeUndefined()
    expect(lock.packages['@moss/app-settings']).toBeUndefined()
    expect(lock.workspaces[spec.appRoot].version).toBe(app.manifest.version)
    if (directory === 'dbx') {
      expect(await fs.readFile(path.join(root, spec.appRoot, 'runtime/package-lock.json'), 'utf8')).toContain('@dbx-app/mcp-server')
      const runtimePackage = JSON.parse(await fs.readFile(path.join(root, spec.appRoot, 'runtime/package.json'), 'utf8'))
      expect(runtimePackage.mossBundleAllPlatforms).toBe(true)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('DBX launches the pinned upstream service offline and carries every platform binary', async () => {
  const root = path.join(repoRoot, 'tool-apps/dbx')
  const definition = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8'))
  expect(definition.mcpServers.dbx.command).toBe('node')
  expect(definition.mcpServers.dbx.args).toEqual(['@app/runtime/node_modules/@dbx-app/mcp-server/bin/dbx-mcp-server.js', '--stdio'])
  expect(definition.mcpServers.dbx.env).toBeUndefined()
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'runtime/package.json'), 'utf8'))
  expect(pkg.mossBundleAllPlatforms).toBe(true)
  const lock = JSON.parse(await fs.readFile(path.join(root, 'runtime/package-lock.json'), 'utf8'))
  expect(Object.keys(pkg.dependencies)).toHaveLength(7)
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    expect(version).toBe('0.4.127')
    expect(lock.packages[`node_modules/${name}`].version).toBe(version)
    expect(lock.packages[`node_modules/${name}`].integrity).toMatch(/^sha512-/)
    expect(lock.packages[`node_modules/${name}`].optional).not.toBe(true)
  }
  const provenance = JSON.parse(await fs.readFile(path.join(root, 'runtime/native/provenance.json'), 'utf8'))
  expect(provenance.files).toHaveLength(2)
  for (const entry of provenance.files) {
    const bytes = await fs.readFile(path.join(root, 'runtime/native', entry.path))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
    const platform = entry.path.split('/')[0]
    expect(pkg.mossRuntimeFiles[`native/${entry.path}`]).toBe(`node_modules/@dbx-app/mcp-${platform}/bin/vcruntime140.dll`)
    expect(bytes.readUInt16LE(bytes.readUInt32LE(60) + 4)).toBe(platform.endsWith('arm64') ? 0xaa64 : 0x8664)
  }
})

test('platform jobs include universal Apps and build native packages only on supported hosts', () => {
  expect(selectApps(['--supported-platform', 'linux-x64']).some(app => app.manifest.id === 'moss.computer-use')).toBe(false)
  expect(selectApps(['--supported-platform', 'linux-x64']).some(app => app.manifest.id === 'moss.drawio')).toBe(true)
  expect(selectApps(['--platform-packages', '--supported-platform', 'darwin-arm64']).map(app => app.manifest.id)).toContain('moss.computer-use')
  const linuxNative = selectApps(['--platform-packages', '--supported-platform', 'linux-x64']).map(app => app.manifest.id)
  expect(linuxNative).toContain('moss.openim')
  expect(linuxNative).not.toContain('moss.computer-use')
})
