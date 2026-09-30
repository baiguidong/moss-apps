import { expect, test } from 'bun:test'
import { createEnvelope, type AppServiceEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createMcpBackend } from '../src/backend/backend'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'
const identity = { appId: 'moss.mcp', instanceId: 'default', generation: 'test' }
async function fixture(respond: (method: string, input: unknown) => unknown = () => ({ servers: [] })) {
  const messages: AppServiceEnvelope<any>[] = []
  const backend = createMcpBackend({ send: (message: AppServiceEnvelope<any>) => {
    messages.push(message)
    if (message.type === 'host.request') void Promise.resolve().then(async () => {
      try { await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: 'moss.mcp/v1', ok: true, result: await respond(message.payload.method, message.payload.input) }, { id: message.id })) }
      catch (error: any) { await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: 'moss.mcp/v1', ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id })) }
    })
  } })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, protocols: manifest.backend.protocols, permissions: manifest.permissions, grants: manifest.permissions }))
  return { backend, messages, async invoke(name: string, input = {}) {
    const message = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(message)
    return messages.find(item => item.id === message.id && ['action.result', 'action.error'].includes(item.type))!
  } }
}
test('forwards MCP operations through the declared protocol without adding assistant tools', async () => {
  const f = await fixture()
  const result = (await f.invoke('servers.set-enabled', { name: 'docs', enabled: false })).payload.result
  expect(result).toEqual({ ok: true, data: { servers: [] } })
  expect(f.messages.find(message => message.type === 'host.request')?.payload).toMatchObject({ protocol: 'moss.mcp/v1', method: 'servers.set-enabled', input: { name: 'docs', enabled: false } })
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
  const f = await fixture(() => new Promise(() => {}))
  const invoke = createEnvelope('action.invoke', { name: 'auth.start', input: { name: 'docs' } })
  const pending = f.backend.handleMessage(invoke)
  await Promise.resolve()
  await f.backend.handleMessage(createEnvelope('action.cancel', { requestId: invoke.id }))
  await pending
  expect(f.messages.some(message => message.type === 'host.cancel')).toBe(true)
  expect(f.messages.find(message => message.type === 'action.result')?.payload.result).toMatchObject({ ok: false, error: { code: 'APP_ACTION_CANCELED' } })
})
