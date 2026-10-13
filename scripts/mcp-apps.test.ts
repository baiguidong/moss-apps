import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { listApps, selectApps, repoRoot } from './lib.mjs'
import { exportAppSource, parseLock } from './source-package.mjs'

test('discovers ordinary and config Apps with their own resource locations', () => {
  const apps = listApps()
  expect(apps.find(app => app.manifest.id === 'moss.git')?.kind).toBe('app')
  const drawio = apps.find(app => app.manifest.id === 'moss.drawio')!
  expect(drawio.kind).toBe('mcp')
  expect(drawio.resourceRoot).toBe(path.join(repoRoot, 'mcp-apps/drawio/resources'))
  expect(drawio.manifest.publisher?.id).toBe('moss')
})
test('invalid source is reported separately; duplicate identities remain fatal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-discovery-'))
  const input = JSON.parse(await fs.readFile(path.join(repoRoot, 'mcp-apps/drawio/app.json'), 'utf8'))
  delete input.icon
  try {
    const appRoot = path.join(root, 'mcp-apps/example')
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
test('MCP source snapshot contains its shared generator and a focused locked workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-config-source-'))
  try {
    const spec = await exportAppSource(selectApps(['--app', 'moss.drawio'])[0], root)
    expect(spec.appRoot).toBe('mcp-apps/drawio')
    const pkg = JSON.parse(await fs.readFile(path.join(root, spec.appRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts.build).toBe('node ../../scripts/build-mcp-app.mjs')
    expect(await fs.readFile(path.join(root, 'scripts/build-mcp-app.mjs'), 'utf8')).toContain('generateMcpApp')
    const lock = parseLock(await fs.readFile(path.join(root, 'bun.lock'), 'utf8'))
    expect(lock.packages['@moss/app-runtime']).toBeDefined()
    expect(lock.packages['@moss/git-app']).toBeUndefined()
    expect(lock.workspaces[spec.appRoot].version).toBe('0.1.4')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
