import { expect, test } from 'bun:test'
import { createEnvelope, type AppServiceEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createThinkingBackend } from '../src/backend/backend'
import { bundledEntry } from '../src/backend/builtin-config'
import { THINKING } from '../src/contracts'
import { thinkingConfig } from '../src/backend/builtin-config'
const DEFAULT_CONFIG = thinkingConfig()
import type { Result } from '../src/contracts'
import type { McpServer } from '@moss/app-sdk/mcp'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'

const identity = { appId: 'moss.sequential-thinking', instanceId: 'default', generation: 'test' }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
async function fixture(options: { initial?: McpServer[]; inspect?: () => Promise<void>; failure?: string } = {}) {
  let servers: McpServer[] = structuredClone(options.initial || [])
  let failure = options.failure
  const messages: AppServiceEnvelope<any>[] = []
  const backend = createThinkingBackend({ send: (message: AppServiceEnvelope<any>) => {
    messages.push(message)
    if (message.type === 'host.request') void Promise.resolve().then(async () => {
      try {
        const { method, input } = message.payload
        if (method === 'servers.save') {
          const previous = servers.find(server => server.name === input.previousName)
          if (!input.previousName && servers.some(server => server.name === input.name)) throw new Error('已有同名服务')
          servers = servers.filter(server => server !== previous)
          servers.push({ name: input.name, enabled: input.enabled, config: input.config, updatedAt: (previous?.updatedAt || 0) + 1, credentialsMissing: false, check: null })
        }
        if (method === 'servers.inspect') {
          const snapshot = servers[0]
          await options.inspect?.()
          if (snapshot === servers[0]) snapshot.check = failure ? { state: 'failed', error: failure, tools: [], checkedAt: Date.now() }
            : { state: 'connected', checkedAt: Date.now(), tools: [{ name: 'sequentialthinking', description: 'Click', disabled: false }] }
        }
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: true, result: structuredClone({ servers }) }, { id: message.id }))
      } catch (error: any) {
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id }))
      }
    })
  } })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, protocols: ['moss.host/v1', ...manifest.host.protocols], permissions: manifest.permissions, grants: manifest.permissions }))
  const invoke = async (name: string, input = {}): Promise<Result> => {
    const envelope = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(envelope)
    return messages.find(message => message.id === envelope.id && message.type === 'action.result')!.payload.result
  }
  return { backend, messages, invoke, stored: () => structuredClone(servers), recover: () => { failure = undefined } }
}

test('registers after ready, inspects after ready without any UI request, and remains idempotent', async () => {
  const f = await fixture()
  await tick()
  expect(f.stored()).toMatchObject([{ name: THINKING, enabled: true, config: DEFAULT_CONFIG }])
  await tick()
  const ready = f.messages.findIndex(message => message.type === 'service.ready')
  const inspect = f.messages.findIndex(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')
  expect(inspect).toBeGreaterThan(ready)
  expect(f.messages.slice(0, ready).some(message => message.type === 'event.emit')).toBe(false)
  const result = await f.invoke('servers.list')
  expect(result).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
  expect(compileJsonSchema(schema)(result)).toBe(true)
  await Promise.all([f.invoke('servers.list'), f.invoke('servers.list')])
  expect(f.messages.filter(message => message.type === 'host.request' && message.payload.method === 'servers.save')).toHaveLength(1)
  expect(manifest.toolScope).toBe('global')
  expect(manifest.permissions).not.toContain('mcp:auth')
})

test('slow inspection does not block Backend readiness and duplicate reconnects share it', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture({ inspect: () => gate })
  await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'connecting' } } })
  await Promise.all([f.invoke('servers.inspect', {}), f.invoke('servers.inspect', {})])
  expect(f.messages.filter(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toHaveLength(1)
  release(); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('reports startup failure without blocking configuration and reconnect recovers', async () => {
  const f = await fixture({ failure: '服务启动失败' }); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'failed', error: '服务启动失败' } } })
  f.recover()
  await f.invoke('servers.inspect', {}); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('restart rebases its own launcher and rejects foreign service input', async () => {
  const f = await fixture({ initial: [{ name: THINKING, enabled: false, updatedAt: 1, credentialsMissing: false, check: null,
    config: { type: 'stdio', command: '/old/node', args: ['/old/cli.mjs'] } }] }); await tick()
  expect(f.stored()[0].config).toEqual(DEFAULT_CONFIG)
  expect(f.stored()[0].enabled).toBe(true)
  const restarted = await fixture({ initial: f.stored() }); await tick()
  expect(restarted.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.save')).toBe(false)
  expect(await f.invoke('servers.inspect', { name: 'another-service' })).toMatchObject({ ok: false })
})
