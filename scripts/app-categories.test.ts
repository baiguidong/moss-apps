import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { APP_CATEGORIES, getAppCategoryForApp, validateAppManifest } from '@moss/app-sdk'
import { listApps, validateMarketplaceMetadata } from './lib.mjs'

test('repository Apps declare supported primary categories and derive marketplace metadata from their manifests', () => {
  const apps = listApps()
  const expected = {
    communication: ['moss.feishu', 'moss.openim'],
    knowledge: ['moss.library', 'moss.notion', 'moss.zsxq'],
    files: ['moss.drive', 'moss.filesystem', 'moss.backup'],
    creative: ['moss.drawio', 'moss.canva', 'moss.media-tools'],
    data: ['moss.database', 'moss.excel', 'moss.bazhuayu'],
    sales: ['moss.sharecrm', 'moss.yunke-cli'],
    marketing: ['moss.tencentads', 'moss.tiktok'],
    finance: ['moss.tushare', 'moss.wind-finance'],
    business: ['moss.tplus-api', 'moss.yzf-general-mcp-server'],
    hr: ['moss.beisen-cli', 'moss.moka'],
    education: ['moss.fenbi-baokao-decision', 'moss.xiaoe-cloud-cli'],
    legal: ['moss.qcc-company', 'moss.pkulaw'],
    life: ['moss.tencent-map', 'moss.ctrip-wendao'],
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
    expect(raw.category, app.manifest.id).not.toBe('other')
    expect(app.marketplace.category).toBe(raw.category)
    expect(app.marketplace.categories).toEqual([category!.label])
    expect(app.marketplace.keywords).toEqual(raw.keywords || [])
    expect(JSON.parse(readFileSync(app.marketplacePath, 'utf8'))).not.toHaveProperty('categories')
  }
})

test('legacy installed categories use display-only migration without rewriting manifests', () => {
  const legacy = { id: 'moss.tencent-map', category: 'other' }
  expect(getAppCategoryForApp(legacy).id).toBe('life')
  expect(legacy.category).toBe('other')
  expect(getAppCategoryForApp({ id: 'moss.filesystem', category: 'knowledge' }).id).toBe('files')
  expect(getAppCategoryForApp({ id: 'moss.tencent-map', category: 'data' }).id).toBe('data')
  expect(getAppCategoryForApp({ id: 'external.custom', category: 'other' }).id).toBe('other')
})

test('extended categories require a compatible Host and old categories keep existing ranges', () => {
  const manifest = listApps().find(app => app.manifest.id === 'moss.database')!.manifest
  expect(manifest.hostApi).toBe('^3.21.0')
  expect(() => validateAppManifest({ ...manifest, hostApi: '^3.20.0' })).toThrow('Extended App categories')
  expect(() => validateAppManifest(manifest, { hostApiVersion: '3.20.0' })).toThrow('requires Host API')
  expect(listApps().find(app => app.manifest.id === 'moss.filesystem')!.manifest.hostApi).toBe('^3.21.0')
  expect(listApps().find(app => app.manifest.id === 'moss.tencent-map')!.manifest.hostApi).toBe('^3.21.0')
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
