import { test, expect } from 'bun:test'
import fs from 'node:fs'
import { createBuilderActions } from '../apps/app-builder/src/backend/actions.mjs'
import { listApps, validateRepositoryAppManifest } from './lib.mjs'

test('Builder navigation templates satisfy repository validation', async () => {
  const { templates } = await createBuilderActions(async () => ({})).builder_inspect({ operation: 'guidance' })
  for (const scenario of ['operational', 'settings', 'backend']) {
    const raw = JSON.parse(templates[`${scenario}-app.moss.json`])
    expect(validateRepositoryAppManifest(raw).navigation).toEqual(raw.navigation)
  }
})

test('all repository Apps explicitly choose navigation; Sequential Thinking stays global', () => {
  const apps = listApps()
  expect(apps.length).toBeGreaterThan(0)
  for (const app of apps) {
    if (app.kind === 'tool') {
      if (app.manifest.mcpApp) {
        expect(app.manifest.navigation).toEqual({ location: 'settings', viewId: 'settings' })
        expect(app.manifest.ui.builtin).toBe('mcp')
      } else {
        expect(app.manifest.navigation).toEqual({ location: 'none' })
        expect(app.manifest.ui).toBeUndefined()
      }
      continue
    }
    const raw = JSON.parse(fs.readFileSync(`${app.root}/app.moss.json`, 'utf8'))
    expect(app.manifest.navigation).toEqual(raw.navigation)
  }
  expect(apps.find(app => app.manifest.id === 'moss.sequential-thinking')?.manifest).toMatchObject({ navigation: { location: 'settings', viewId: 'settings' }, toolScope: 'global' })
  for (const id of ['moss.feishu', 'moss.computer-use']) expect(apps.find(app => app.manifest.id === id)?.manifest.navigation.location).toBe('settings')
})
