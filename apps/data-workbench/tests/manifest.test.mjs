import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { loadJsonSchema, validateAppManifest } from '@moss/app-sdk'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await fs.readFile(new URL('app.moss.json', root), 'utf8'))

test('manifest uses only Host capabilities without cross-App declarations', () => {
  const validated = validateAppManifest(manifest, { requireNavigation: true })
  assert.deepEqual(validated.permissions, ['local-files:pick'])
  assert.deepEqual(validated.host.protocols, ['moss.local-files/v1', 'moss.runtime/v1', 'moss.artifacts/v1'])
  assert.equal(manifest.appCapabilities, undefined)
  assert.equal(validated.appCapabilities, undefined)
  assert.equal(validated.hostApi, '^3.21.0')
  assert.equal(validated.backend.lifecycle, 'on-demand')
})

test('normal tools and CLI skill remain available without dataset actions', () => {
  assert.deepEqual(manifest.backend.actions.map(action => action.name), [
    'workspace.get', 'catalog.get', 'engine.prepare', 'paths.pick',
    'tasks.start', 'tasks.get', 'tasks.cancel', 'artifacts.read', 'artifacts.export',
  ])
  assert.deepEqual(manifest.contributes.tools.map(tool => [tool.id, tool.action]), [
    ['run', 'tasks.start'], ['task', 'tasks.get'], ['catalog', 'catalog.get'],
    ['list', 'workspace.get'], ['cancel', 'tasks.cancel'], ['read-result', 'artifacts.read'],
  ])
  assert.equal(manifest.contributes.skills[0].id, 'moss-data-workbench')
  assert.equal(manifest.contributes.skills[0].cli, 'dist/backend/cli.mjs')
  for (const action of manifest.backend.actions) {
    loadJsonSchema(fileURLToPath(root), action.inputSchema)
    loadJsonSchema(fileURLToPath(root), action.outputSchema)
  }
})

test('UI and backend do not expose explicit data sharing', async () => {
  const ui = await fs.readFile(new URL('src/App.tsx', root), 'utf8')
  const backend = await fs.readFile(new URL('src/backend/main.mjs', root), 'utf8')
  assert.doesNotMatch(ui, /dataset\.|共享数据源|取消共享|可供其他 App/)
  assert.doesNotMatch(backend, /dataset|registerDatasetActions/)
})

test('package and manifest versions stay aligned', async () => {
  const metadata = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.version, '0.2.2')
  assert.equal(metadata.version, manifest.version)
})
