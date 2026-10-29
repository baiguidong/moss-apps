import { expect, test } from 'bun:test'
import { createEnvelope, type AppServiceEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createMemoryBackend } from '../src/backend/backend'
import { bundledEntry } from '../src/backend/builtin-config'
import { MEMORY } from '../src/contracts'
import { memoryConfig } from '../src/backend/builtin-config'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const dataDir = join(tmpdir(), 'moss-memory-unit')
const memoryFile = join(dataDir, 'memory', 'knowledge-graph.jsonl')
const DEFAULT_CONFIG = memoryConfig(memoryFile)
import type { McpServer, SaveInput, Result } from '../src/contracts'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'

const identity = { appId: 'moss.memory', instanceId: 'default', generation: 'test' }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
async function fixture(options: { initial?: McpServer[]; inspect?: () => Promise<void>; failure?: string } = {}) {
  let servers: McpServer[] = structuredClone(options.initial || [])
  let failure = options.failure
  const messages: AppServiceEnvelope<any>[] = []
  const backend = createMemoryBackend({ send: (message: AppServiceEnvelope<any>) => {
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
            : { state: 'connected', checkedAt: Date.now(), tools: [{ name: 'read_graph', description: 'Click', disabled: false }] }
        }
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: true, result: structuredClone({ servers }) }, { id: message.id }))
      } catch (error: any) {
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id }))
      }
    })
  } })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, dataDir, protocols: ['moss.host/v1', ...manifest.host.protocols], permissions: manifest.permissions, grants: manifest.permissions }))
  const invoke = async (name: string, input = {}): Promise<Result> => {
    const envelope = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(envelope)
    return messages.find(message => message.id === envelope.id && message.type === 'action.result')!.payload.result
  }
  return { backend, messages, invoke, stored: () => structuredClone(servers), recover: () => { failure = undefined } }
}

test('initialization registers without connecting; reads stay local and explicit inspection connects', async () => {
  const f = await fixture()
  await tick()
  expect(f.stored()).toMatchObject([{ name: MEMORY, enabled: true, config: DEFAULT_CONFIG }])
  expect(f.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toBe(false)
  expect(compileJsonSchema(schema)(await f.invoke('servers.list'))).toBe(true)
  expect(f.stored()).toMatchObject([{ name: MEMORY, enabled: true, config: DEFAULT_CONFIG }])
  expect(f.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toBe(false)
  await f.invoke('servers.inspect')
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
  expect(manifest.contributes).not.toHaveProperty('tools')
  expect(manifest.permissions).not.toContain('mcp:auth')
})

test('slow inspection does not block Backend readiness and duplicate reconnects share it', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture({ inspect: () => gate })
  await tick()
  await f.invoke('servers.inspect')
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'connecting' } } })
  await Promise.all([f.invoke('servers.inspect', {}), f.invoke('servers.inspect', {})])
  expect(f.messages.filter(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toHaveLength(1)
  release(); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('reports requested inspection failure without blocking configuration and reconnect recovers', async () => {
  const f = await fixture({ failure: '记忆文件不可写' }); await tick()
  await f.invoke('servers.inspect'); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'failed', error: '记忆文件不可写' } } })
  f.recover()
  await f.invoke('servers.inspect', {}); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('restart rebases the launcher and preserves exclusions and the persistent data path', async () => {
  const config = { ...DEFAULT_CONFIG, command: '/old/node', args: ['/old/cli.mjs', '/old/data'], disabledTools: ['delete_entities'] }
  const f = await fixture({ initial: [{ name: MEMORY, enabled: true, updatedAt: 1, credentialsMissing: false, check: null, config }] })
  await tick()
  await f.invoke('servers.list')
  expect(f.stored()[0].config).toEqual(memoryConfig(memoryFile, ['delete_entities']))
  const restarted = await fixture({ initial: f.stored() }); await tick()
  expect(restarted.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.save')).toBe(false)
})

test('settings cancel stale inspection and cannot change the managed command or data file', async () => {
  let release!: () => void, calls = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture({ inspect: () => ++calls === 1 ? gate : Promise.resolve() }); await tick()
  await f.invoke('servers.inspect'); await tick()
  const input: SaveInput = { disabledTools: ['delete_entities'] }
  expect(await f.invoke('servers.save', input)).toMatchObject({ ok: true })
  await tick(); release(); await tick()
  expect(f.messages.some(message => message.type === 'host.cancel')).toBe(true)
  expect(calls).toBe(1)
  expect(f.stored()[0].config).toEqual(memoryConfig(memoryFile, input.disabledTools))
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'idle' }, memoryFile } })
  expect(await f.invoke('servers.save', { ...input, config: { command: 'anything' } })).toMatchObject({ ok: false })
  expect(await f.invoke('servers.inspect', { name: 'another-service' })).toMatchObject({ ok: false })
  expect(await f.invoke('servers.save', { disabledTools: [4] })).toMatchObject({ ok: false })
})


test('re-registration preserves an intentionally disabled service and its exclusions', async () => {
  const f = await fixture({ initial: [{ name: MEMORY, enabled: false, updatedAt: 1, credentialsMissing: false, check: null,
    config: { ...DEFAULT_CONFIG, command: '/old/node', disabledTools: ['delete_entities'] } }] })
  expect(f.stored()[0]).toMatchObject({ enabled: false, config: memoryConfig(memoryFile, ['delete_entities']) })
  await f.invoke('servers.list')
  expect(f.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toBe(false)
})
