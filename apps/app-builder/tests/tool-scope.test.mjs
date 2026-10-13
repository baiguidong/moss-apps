import { test, expect } from 'bun:test'
import { createBuilderActions } from '../src/backend/actions.mjs'
import { validateAppManifest } from '@moss/app-sdk'

test('Builder exposes an executable default-session template using the current SDK', async () => {
  const actions = createBuilderActions(async () => ({}))
  const result = await actions.builder_inspect({ operation: 'guidance' })
  const raw = JSON.parse(result.templates['app.moss.json'])
  expect(validateAppManifest(raw).toolScope).toBe('session')
  const global = { ...raw, toolScope: 'global' }
  expect(validateAppManifest(global).toolScope).toBe('global')
  expect(() => validateAppManifest({ ...raw, hostApi: '^3.0.0' })).toThrow('3.1.0')
  expect(result.guidance).toContain("Preserve an existing App's scope")
  expect(result.templates['README.md']).toContain('every App-owned MCP service inherits')
})


test('Builder guidance produces a valid generic native subservice contract with the pinned SDK', async () => {
  const result = await createBuilderActions(async () => ({})).builder_inspect({ operation: 'guidance' })
  const raw = JSON.parse(result.templates['app.moss.json'])
  raw.hostApi = '^3.8.0'; raw.toolSelection = 'services'
  raw.backend = { entry: 'dist/backend/main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: [{ name: 'example', inputSchema: 'schemas/example.json' }] }
  raw.contributes = { services: [{ id: 'sales', title: '销售服务' }], tools: [{ id: 'read-sales', title: '查询销售', description: '读取销售数据', effect: 'read', action: 'example', inputSchema: 'schemas/example.json' }] }
  for (const tool of raw.contributes.tools) tool.serviceId = 'sales'
  const manifest = validateAppManifest(raw)
  expect(manifest.toolSelection).toBe('services')
  expect(manifest.contributes.tools.every(tool => tool.serviceId === 'sales')).toBe(true)
  expect(result.guidance).toContain('selecting a child must never add its parent as a wildcard')
  expect(result.templates['README.md']).toContain('Select-all captures current children')
  raw.contributes.services = []
  expect(() => validateAppManifest(raw)).toThrow('serviceId')
})
