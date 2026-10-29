import { test, expect } from 'bun:test'
import { createBuilderActions } from '../src/backend/actions.mjs'
import { validateAppManifest } from '@moss/app-sdk'

test('Builder requires a purpose-based navigation choice and supplies three valid scenarios', async () => {
  const { guidance, templates } = await createBuilderActions(async () => ({})).builder_inspect({ operation: 'guidance' })
  expect(guidance).toContain('普通编辑保留原展示位置')
  expect(validateAppManifest(JSON.parse(templates['app.moss.json']), { requireNavigation: true }).navigation.location).toBe('none')
  for (const [scenario, location] of [['operational', 'more'], ['settings', 'settings'], ['backend', 'none']]) {
    const raw = JSON.parse(templates[`${scenario}-app.moss.json`])
    const normalized = validateAppManifest(raw, { requireNavigation: true })
    expect(normalized.navigation.location).toBe(location)
    if (location === 'settings') expect(normalized.contributes.settings[0].group).toBe('apps')
  }
})
