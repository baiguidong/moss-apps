import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { APP_CATEGORIES, validateAppManifest } from '@moss/app-sdk'
import { listApps, validateMarketplaceMetadata } from './lib.mjs'

test('repository Apps declare supported primary categories and derive marketplace metadata from their manifests', () => {
  const apps = listApps()
  const expected = {
    communication: ['moss.feishu', 'moss.openim'],
    knowledge: ['moss.library', 'moss.drive', 'moss.filesystem'],
    automation: ['moss.workflow', 'moss.browser-use', 'moss.computer-use'],
    ai: ['moss.memory', 'moss.sequential-thinking', 'moss.mcp'],
    development: ['moss.app-builder', 'moss.devtools', 'moss.git'],
    diagnostics: ['moss.trace', 'moss.audit'],
  }
  for (const [category, ids] of Object.entries(expected)) {
    for (const id of ids) expect(apps.find(app => app.manifest.id === id)?.manifest.category).toBe(category)
  }
  for (const app of apps) {
    const raw = JSON.parse(readFileSync(app.manifestPath, 'utf8'))
    const category = APP_CATEGORIES.find(category => category.id === raw.category)
    expect(category).toBeDefined()
    expect(app.marketplace.category).toBe(raw.category)
    expect(app.marketplace.categories).toEqual([category!.label])
    expect(app.marketplace.keywords).toEqual(raw.keywords || [])
    expect(JSON.parse(readFileSync(app.marketplacePath, 'utf8'))).not.toHaveProperty('categories')
  }
})

test('conflicting legacy marketplace categories and keywords cannot override the Manifest', () => {
  const app = listApps().find(app => app.manifest.id === 'moss.browser-use')!
  const metadata = JSON.parse(readFileSync(app.marketplacePath, 'utf8'))
  expect(() => validateMarketplaceMetadata({ ...metadata, categories: ['开发工具'] }, app.manifest, app.marketplacePath)).toThrow(/generated from/)
  expect(() => validateMarketplaceMetadata({ ...metadata, keywords: ['unrelated'] }, app.manifest, app.marketplacePath)).toThrow(/generated from/)
  expect(validateMarketplaceMetadata({ ...metadata, categories: ['自动化'], keywords: app.manifest.keywords }, app.manifest, app.marketplacePath).category).toBe('automation')
})

test('the Builder template exposes category and preserves it with the pinned SDK', () => {
  const template = JSON.parse(readFileSync(new URL('../apps/app-builder/resources/authoring/app.moss.json', import.meta.url), 'utf8'))
  expect(template.category).toBe('other')
  expect(validateAppManifest({ ...template, category: 'knowledge', keywords: ['资料'] })).toMatchObject({ category: 'knowledge', keywords: ['资料'] })
})
