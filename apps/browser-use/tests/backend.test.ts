import { expect, test } from 'bun:test'
import { createEnvelope, type AppServiceEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createBrowserBackend } from '../src/backend/backend'
import { bundledEntry } from '../src/backend/builtin-config'
import { DEFAULT_CONFIG, PLAYWRIGHT_CDP } from '../src/browser-config'
import type { McpServer, SaveInput, Result } from '../src/contracts'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'

const identity = { appId: 'moss.browser-use', instanceId: 'default', generation: 'test' }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
async function fixture(options: { initial?: McpServer[]; inspect?: () => Promise<void>; prepare?: (options: { signal: AbortSignal }) => Promise<string>; failure?: string } = {}) {
  let servers: McpServer[] = structuredClone(options.initial || [])
  let failure = options.failure
  const messages: AppServiceEnvelope<any>[] = []
  const backend = createBrowserBackend({ send: (message: AppServiceEnvelope<any>) => {
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
            : { state: 'connected', checkedAt: Date.now(), tools: [{ name: 'browser_click', description: 'Click', disabled: false }] }
        }
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: true, result: structuredClone({ servers }) }, { id: message.id }))
      } catch (error: any) {
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id }))
      }
    })
  } }, { prepareManagedBrowser: options.prepare || (async () => '/test/Chrome for Testing') })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, protocols: ['moss.host/v1', ...manifest.host.protocols], permissions: manifest.permissions, grants: manifest.permissions }))
  const invoke = async (name: string, input = {}): Promise<Result> => {
    const envelope = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(envelope)
    return messages.find(message => message.id === envelope.id && message.type === 'action.result')!.payload.result
  }
  return { backend, messages, invoke, stored: () => structuredClone(servers), recover: () => { failure = undefined } }
}

test('registers before ready, inspects after ready without any UI request, and remains idempotent', async () => {
  const f = await fixture()
  expect(f.stored()).toMatchObject([{ name: PLAYWRIGHT_CDP, enabled: true, config: { command: process.execPath, args: [bundledEntry, ...DEFAULT_CONFIG.args!.slice(1)] } }])
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
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'connecting' } } })
  await Promise.all([f.invoke('servers.inspect', { name: PLAYWRIGHT_CDP }), f.invoke('servers.inspect', { name: PLAYWRIGHT_CDP })])
  expect(f.messages.filter(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toHaveLength(1)
  release(); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('first-use browser preparation stays visible without timing out Backend initialization', async () => {
  let release!: (path: string) => void
  const preparation = new Promise<string>(resolve => { release = resolve })
  const f = await fixture({ prepare: () => preparation })
  await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'preparing' } } })
  expect(f.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toBe(false)
  release('/test/Chrome for Testing'); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('reports startup failure without blocking configuration and reconnect recovers', async () => {
  const f = await fixture({ failure: '未找到系统 Chrome' }); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'failed', error: '未找到系统 Chrome' } } })
  f.recover()
  await f.invoke('servers.inspect', { name: PLAYWRIGHT_CDP }); await tick()
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('restart rebases only its launcher and preserves its own browser configuration', async () => {
  const config = { ...DEFAULT_CONFIG, command: '/old/node', args: ['/old/playwright-cdp/cli.cjs', '--cdp-endpoint', 'http://localhost:9444', '--output-dir', '~/My Browser'], env: { TOKEN: '' }, disabledTools: ['browser_close'] }
  const f = await fixture({ initial: [{ name: PLAYWRIGHT_CDP, enabled: true, updatedAt: 1, credentialsMissing: false, check: null, config }] })
  await tick()
  expect(f.stored()[0].config).toEqual({ ...config, command: process.execPath, args: [bundledEntry, ...config.args.slice(1)] })
  const restarted = await fixture({ initial: f.stored() }); await tick()
  expect(restarted.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.save')).toBe(false)
})

test('upgrading replaces the old default CDP connection before inspecting, without reapplying migration', async () => {
  const config = { ...DEFAULT_CONFIG, args: ['/old/playwright-cdp/cli.cjs', '--cdp-endpoint', 'http://127.0.0.1:9222', '--output-dir', '~/Output'], env: { TOKEN: '' }, disabledTools: ['browser_close'] }
  const f = await fixture({ initial: [{ name: PLAYWRIGHT_CDP, enabled: true, updatedAt: 1, credentialsMissing: false, check: null, config }] })
  await tick()
  expect(f.stored()[0].config).toEqual({ ...config, command: process.execPath, args: [bundledEntry, '--moss-managed-browser', '--output-dir', '~/Output'] })
  const restarted = await fixture({ initial: f.stored() }); await tick()
  expect(restarted.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.save')).toBe(false)
})

test('save cancels old preparation and only the new configuration check becomes ready', async () => {
  let release!: () => void, calls = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture({ inspect: () => ++calls === 1 ? gate : Promise.resolve() }); await tick()
  const input: SaveInput = { name: PLAYWRIGHT_CDP, previousName: PLAYWRIGHT_CDP, enabled: true, config: { ...DEFAULT_CONFIG, args: [...DEFAULT_CONFIG.args!, '--timeout-action', '7000'] } }
  expect(await f.invoke('servers.save', input)).toMatchObject({ ok: true })
  await tick(); release(); await tick()
  expect(f.messages.some(message => message.type === 'host.cancel')).toBe(true)
  expect(f.stored()[0].config.args?.at(-1)).toBe('7000')
  expect(await f.invoke('servers.list')).toMatchObject({ ok: true, data: { preparation: { state: 'ready' } } })
})

test('rejects attempts to manage other services or disable the managed connection separately', async () => {
  const f = await fixture(); await tick()
  expect(await f.invoke('servers.inspect', { name: 'another-service' })).toMatchObject({ ok: false })
  expect(await f.invoke('servers.save', { name: PLAYWRIGHT_CDP, previousName: PLAYWRIGHT_CDP, enabled: false, config: DEFAULT_CONFIG })).toMatchObject({ ok: false })
})
