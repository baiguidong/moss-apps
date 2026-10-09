import { expect, test } from 'bun:test'
import { createEnvelope, type AppServiceEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createMcpBackend } from '../src/backend/backend'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'
import { BUILTIN_SERVERS, PLAYWRIGHT_CDP } from '../src/builtins'
import { builtinServers, bundledEntry } from '../src/backend/builtin-config'
import type { McpServer, SaveInput } from '../src/contracts'
const identity = { appId: 'moss.mcp', instanceId: 'default', generation: 'test' }
async function fixture(respond?: (method: string, input: any) => unknown, initial: McpServer[] = []) {
  let servers = structuredClone(initial)
  const handle = async (method: string, input: SaveInput) => {
    const response = await respond?.(method, input)
    if (response !== undefined) return response
    if (method === 'servers.save') {
      if (!input.previousName && servers.some(server => server.name === input.name)) throw new Error('已有同名服务')
      servers = servers.filter(server => server.name !== input.previousName)
      servers.push({ name: input.name, enabled: input.enabled, config: input.config, updatedAt: Date.now() })
    } else if (method === 'servers.set-enabled') {
      const server = servers.find(server => server.name === input.name)
      if (server) server.enabled = input.enabled
    }
    return structuredClone({ servers: servers.map(server => ({ credentialsMissing: false, check: null, ...server })) })
  }
  const messages: AppServiceEnvelope<any>[] = []
  const backend = createMcpBackend({ send: (message: AppServiceEnvelope<any>) => {
    messages.push(message)
    if (message.type === 'host.request') void Promise.resolve().then(async () => {
      try { await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: 'moss.mcp/v1', ok: true, result: await handle(message.payload.method, message.payload.input) }, { id: message.id })) }
      catch (error: any) { await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: 'moss.mcp/v1', ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id })) }
    })
  } })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, protocols: manifest.backend.protocols, permissions: manifest.permissions, grants: manifest.permissions }))
  return { backend, messages, stored: () => structuredClone(servers), async invoke(name: string, input = {}) {
    const message = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(message)
    return messages.find(item => item.id === message.id && ['action.result', 'action.error'].includes(item.type))!
  } }
}
test('forwards MCP operations through the declared protocol without adding assistant tools', async () => {
  const f = await fixture()
  const result = (await f.invoke('servers.set-enabled', { name: 'docs', enabled: false })).payload.result
  expect(result).toMatchObject({ ok: true, data: { servers: [{ name: PLAYWRIGHT_CDP, builtin: true }] } })
  expect(f.messages.find(message => message.type === 'host.request' && message.payload.method === 'servers.set-enabled')?.payload).toMatchObject({ protocol: 'moss.mcp/v1', method: 'servers.set-enabled', input: { name: 'docs', enabled: false } })
  expect(compileJsonSchema(schema)(result)).toBe(true)
  expect(manifest.contributes).not.toHaveProperty('tools')
  expect((await f.invoke('unknown.method')).type).toBe('action.error')
})
test('surfaces errors and rejects malformed Host output without blanking the page', async () => {
  const failing = await fixture(() => { throw new Error('服务名称冲突') })
  expect((await failing.invoke('servers.list')).payload.result).toMatchObject({ ok: false, error: { message: '服务名称冲突' } })
  const invalid = await fixture(() => ({ servers: null }))
  expect((await invalid.invoke('servers.list')).payload.result.ok).toBe(false)
})
test('canceling an authorization action cancels the pending Host request', async () => {
  const f = await fixture(method => method === 'auth.start' ? new Promise(() => {}) : undefined)
  const invoke = createEnvelope('action.invoke', { name: 'auth.start', input: { name: 'docs' } })
  const pending = f.backend.handleMessage(invoke)
  await new Promise(resolve => setTimeout(resolve, 0))
  await f.backend.handleMessage(createEnvelope('action.cancel', { requestId: invoke.id }))
  await pending
  expect(f.messages.some(message => message.type === 'host.cancel')).toBe(true)
  expect(f.messages.find(message => message.type === 'action.result')?.payload.result).toMatchObject({ ok: false, error: { code: 'APP_ACTION_CANCELED' } })
})


test('registers the enabled built-in before ready without opening the UI', async () => {
  const f = await fixture()
  expect(f.stored()).toMatchObject(builtinServers)
  const saved = f.messages.findIndex(message => message.type === 'host.request' && message.payload.method === 'servers.save')
  const ready = f.messages.findIndex(message => message.type === 'service.ready')
  expect(saved).toBeGreaterThan(-1); expect(ready).toBeGreaterThan(saved)
  await Promise.all([f.invoke('servers.list'), f.invoke('servers.list')])
  expect(f.messages.filter(message => message.type === 'host.request' && message.payload.method === 'servers.save')).toHaveLength(1)
})

test('upgrade and restart preserve customized settings, credentials and disabled state', async () => {
  const existing: McpServer = { name: PLAYWRIGHT_CDP, enabled: false, updatedAt: 123, config: { type: 'stdio', command: 'custom-npx', args: ['--cdp-endpoint', 'http://localhost:9444', '--output-dir', '/custom/output'], env: { KEY: '' }, disabledTools: ['browser_close'] } }
  const f = await fixture(undefined, [existing])
  expect(f.stored()).toEqual([existing])
  expect(f.messages.filter(message => message.payload?.method === 'servers.save')).toHaveLength(0)
  const restarted = await fixture(undefined, f.stored())
  expect(restarted.stored()).toEqual([existing])
  expect((await restarted.invoke('servers.list')).payload.result.data.servers[0].builtin).toBe(true)
})

test('built-ins allow edits and disabling but reject deletion and renaming through actions', async () => {
  const f = await fixture()
  expect((await f.invoke('servers.remove', { name: PLAYWRIGHT_CDP })).payload.result.ok).toBe(false)
  expect((await f.invoke('servers.save', { ...BUILTIN_SERVERS[0], name: 'renamed', previousName: PLAYWRIGHT_CDP })).payload.result.ok).toBe(false)
  expect((await f.invoke('servers.save', { ...BUILTIN_SERVERS[0], previousName: PLAYWRIGHT_CDP, enabled: false })).payload.result.ok).toBe(true)
  const restarted = await fixture(undefined, f.stored())
  expect(restarted.stored()[0].enabled).toBe(false)
})

test('failed setup keeps existing services usable and retries on a later list', async () => {
  let fail = true
  const f = await fixture(method => { if (fail && method === 'servers.save') throw new Error('disk full') }, [{ name: 'docs', enabled: true, updatedAt: 1, config: { type: 'http', url: 'https://example.com/mcp' } }])
  const failed = (await f.invoke('servers.list')).payload.result
  expect(failed).toMatchObject({ ok: true, data: { setupError: expect.stringContaining('disk full'), servers: [{ name: 'docs' }] } })
  fail = false
  const retried = (await f.invoke('servers.list')).payload.result
  expect(retried.data.servers).toHaveLength(2)
  expect(retried.data.setupError).toBeUndefined()
})

test('a concurrent same-name save is adopted without overwriting it', async () => {
  let hasConcurrent = false
  const existing = { credentialsMissing: false, check: null, name: PLAYWRIGHT_CDP, enabled: false, updatedAt: 5, config: { type: 'stdio', command: 'custom' } }
  const f = await fixture(method => {
    if (method === 'servers.save') { hasConcurrent = true; throw new Error('已有同名服务') }
    if (hasConcurrent && method === 'servers.list') return { servers: [existing] }
  })
  const result = (await f.invoke('servers.list')).payload.result
  expect(result).toMatchObject({ ok: true, data: { servers: [{ ...existing, builtin: true }] } })
  expect(f.messages.filter(message => message.payload?.method === 'servers.save')).toHaveLength(1)
})


test('migrates the npx preset to the bundled executable while preserving user options and disabled state', async () => {
  const config = { type: 'stdio' as const, command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--cdp-endpoint', 'http://localhost:9444', '--output-dir', '~/My Artifacts'], env: { KEY: '' }, disabledTools: ['browser_close'] }
  const f = await fixture(undefined, [{ name: PLAYWRIGHT_CDP, enabled: false, updatedAt: 1, config }])
  expect(f.stored()[0]).toMatchObject({ enabled: false, config: { ...config, command: process.execPath, args: [bundledEntry, ...config.args.slice(2)] } })
  const result = (await f.invoke('servers.list')).payload.result
  expect(result.data.servers[0].bundled).toBe(true)
  const restarted = await fixture(undefined, f.stored())
  expect(restarted.messages.filter(message => message.payload?.method === 'servers.save')).toHaveLength(0)
})

test('rebases bundled launch paths after moving machines or upgrading the App', async () => {
  const config = { type: 'stdio' as const, command: 'C:\\Old PC\\node.exe', args: ['C:\\Old PC\\apps\\moss.mcp\\0.1.0\\dist\\playwright-cdp\\cli.cjs', '--output-dir', '~/screenshots'], env: { KEY: '' } }
  const f = await fixture(undefined, [{ name: PLAYWRIGHT_CDP, enabled: false, updatedAt: 1, config }])
  expect(f.stored()[0]).toMatchObject({ enabled: false, config: { ...config, command: process.execPath, args: [bundledEntry, ...config.args.slice(1)] } })
})
