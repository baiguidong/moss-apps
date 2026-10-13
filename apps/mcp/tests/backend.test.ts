import { expect, test } from 'bun:test'
import { createEnvelope, type AppServiceEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createMcpBackend } from '../src/backend/backend'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'
import type { McpServer, SaveInput } from '../src/contracts'
const identity = { appId: 'moss.mcp', instanceId: 'default', generation: 'test' }
async function fixture(respond?: (method: string, input: any) => unknown, initial: McpServer[] = []) {
  let servers = structuredClone(initial)
  const handle = async (method: string, input: SaveInput) => {
    if (method === 'capabilities.get') return { capabilities: [{ protocol: 'moss.mcp/v1', method: 'servers.save', supported: true, allowed: true, available: true, reason: null, permission: 'mcp:write', surfaces: ['backend'], limits: {} }] }
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
      try { await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: true, result: await handle(message.payload.method, message.payload.input) }, { id: message.id })) }
      catch (error: any) { await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id })) }
    })
  } })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, protocols: ['moss.host/v1', ...manifest.host.protocols], permissions: manifest.permissions, grants: manifest.permissions }))
  return { backend, messages, stored: () => structuredClone(servers), async invoke(name: string, input = {}) {
    const message = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(message)
    return messages.find(item => item.id === message.id && ['action.result', 'action.error'].includes(item.type))!
  } }
}
test('starts without registering built-ins and forwards customer services unchanged', async () => {
  const f = await fixture()
  expect(f.stored()).toEqual([])
  expect(f.messages.some(message => message.type === 'host.request')).toBe(false)
  const config = { type: 'stdio', command: 'custom-browser', args: ['--profile', '~/My Profile'] }
  const saved = (await f.invoke('servers.save', { name: 'playwright-cdp', enabled: true, config })).payload.result
  expect(saved).toMatchObject({ ok: true, data: { servers: [{ name: 'playwright-cdp', config }] } })
  expect(saved.data.servers[0]).not.toHaveProperty('builtin')
  expect(compileJsonSchema(schema)(saved)).toBe(true)
  const renamed = (await f.invoke('servers.save', { name: 'my-browser', previousName: 'playwright-cdp', enabled: true, config })).payload.result
  expect(renamed.ok).toBe(true)
  expect((await f.invoke('servers.remove', { name: 'my-browser' })).payload.result.ok).toBe(true)
  expect(manifest.contributes).not.toHaveProperty('tools')
})
test('preserves customer configurations at startup and reports invalid Host output', async () => {
  const original: McpServer = { name: 'playwright-cdp', enabled: false, updatedAt: 1, config: { type: 'stdio', command: 'custom', args: ['--example'] } }
  const f = await fixture(undefined, [original])
  expect(f.stored()).toEqual([original])
  expect((await f.invoke('servers.list')).payload.result).toMatchObject({ ok: true, data: { servers: [original] } })
  const invalid = await fixture(() => ({ servers: null }))
  expect((await invalid.invoke('servers.list')).payload.result.ok).toBe(false)
})
test('canceling an authorization action cancels the Host request', async () => {
  const f = await fixture(method => method === 'auth.start' ? new Promise(() => {}) : undefined)
  const invoke = createEnvelope('action.invoke', { name: 'auth.start', input: { name: 'docs' } })
  const pending = f.backend.handleMessage(invoke)
  await new Promise(resolve => setTimeout(resolve, 0))
  await f.backend.handleMessage(createEnvelope('action.cancel', { requestId: invoke.id }))
  await pending
  expect(f.messages.some(message => message.type === 'host.cancel')).toBe(true)
  expect(f.messages.find(message => message.type === 'action.result')?.payload.result).toMatchObject({ ok: false, error: { code: 'APP_ACTION_CANCELED' } })
})
