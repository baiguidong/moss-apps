import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEnvelope, compileJsonSchema } from '@moss/app-sdk'
import { createServiceBackend } from '../src/backend/backend'
import { serviceConfig } from '../src/backend/builtin-config'
import { SERVICE, DEFAULT_SETTINGS } from '../src/contracts'
import manifest from '../app.moss.json'
import schema from '../schemas/result.json'
import { seedRepository } from './repository.mjs'
const identity = { appId: manifest.id, instanceId: 'default', generation: 'test' }
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(predicate) { for (let i = 0; i < 200; i++) { if (await predicate()) return; await tick() } throw new Error('Condition timed out') }
async function fixture({ initial = [], failure, gate } = {}) {
  let servers = structuredClone(initial)
  const messages = []
  const backend = createServiceBackend({ send(message) {
    messages.push(message)
    if (message.type !== 'host.request') return
    void Promise.resolve().then(async () => {
      try {
        const { method, input } = message.payload
        if (method === 'servers.save') {
          const existing = servers.find(server => server.name === input.previousName)
          if (existing) servers.splice(servers.indexOf(existing), 1)
          servers.push({ name: input.name, enabled: input.enabled, config: input.config, updatedAt: (existing?.updatedAt || 0) + 1, credentialsMissing: false, check: null })
        }
        if (method === 'servers.inspect') {
          const snapshot = servers[0]
          await gate?.()
          if (snapshot === servers[0]) snapshot.check = { state: failure ? 'failed' : 'connected', ...(failure ? { error: failure } : {}), checkedAt: Date.now(), tools: [{ name: 'fixture', description: 'Fixture tool', disabled: false }] }
        }
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: true, result: structuredClone({ servers }) }, { id: message.id }))
      } catch (error) {
        await backend.handleMessage(createEnvelope('host.response', { ...identity, protocol: message.payload.protocol, ok: false, error: { code: 'REQUEST_FAILED', message: error.message } }, { id: message.id }))
      }
    })
  } })
  await backend.handleMessage(createEnvelope('service.init', { ...identity, protocols: ['moss.host/v1', ...manifest.host.protocols], permissions: manifest.permissions, grants: manifest.permissions }))
  const invoke = async (name, input = {}) => {
    const envelope = createEnvelope('action.invoke', { name, input })
    await backend.handleMessage(envelope)
    return messages.find(message => message.id === envelope.id && message.type === 'action.result').payload.result
  }
  return { messages, invoke, stored: () => structuredClone(servers), recover: () => { failure = undefined } }
}
async function directory(root) {
  const path = join(root, 'Configured Directory')
  await seedRepository(path)
  return path
}

test('fresh installation registers an empty shared scope; clearing settings keeps session tools enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-config-'))
  try {
    const path = await directory(root), f = await fixture()
    await until(async () => (await f.invoke('servers.list')).data.preparation.state === 'ready')
    expect(f.stored()).toHaveLength(1)
    expect(f.stored()[0].enabled).toBe(true)
    expect(JSON.parse(f.stored()[0].config.args[1]).directories).toEqual([])
    expect(f.messages.some(message => message.type === 'host.request' && message.payload.method === 'servers.inspect')).toBe(true)
    expect(await f.invoke('servers.save', { ...DEFAULT_SETTINGS, directories: [join(root, 'missing')] })).toMatchObject({ ok: false })
    expect(f.stored()).toHaveLength(1)
    expect(f.stored()[0].enabled).toBe(true)
    expect(JSON.parse(f.stored()[0].config.args[1]).directories).toEqual([])
    const saved = await f.invoke('servers.save', { ...DEFAULT_SETTINGS, directories: [path], disabledTools: ['fixture'] })
    expect(saved.ok).toBe(true); expect(compileJsonSchema(schema)(saved)).toBe(true)
    await until(async () => (await f.invoke('servers.list')).data.preparation.state === 'ready')
    const old = f.stored(), config = old[0].config
    config.command = '/old/node'; config.args[0] = '/old/cli.mjs'
    const restarted = await fixture({ initial: old })
    await until(async () => (await restarted.invoke('servers.list')).data.preparation.state === 'ready')
    expect(restarted.stored()[0].config.command).toBe(process.execPath)
    expect((await restarted.invoke('servers.list')).data.settings.disabledTools).toEqual(['fixture'])
    expect(await restarted.invoke('servers.save', { ...DEFAULT_SETTINGS, command: 'arbitrary' })).toMatchObject({ ok: false })
    expect(await restarted.invoke('servers.inspect', { name: 'other' })).toMatchObject({ ok: false })
    await restarted.invoke('servers.save', DEFAULT_SETTINGS)
    await until(async () => (await restarted.invoke('servers.list')).data.preparation.state === 'ready')
    expect(restarted.stored()[0].enabled).toBe(true)
    const cleared = await fixture({ initial: restarted.stored() })
    await until(async () => (await cleared.invoke('servers.list')).data.preparation.state === 'ready')
    expect(cleared.stored()[0].enabled).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing startup path remains editable and slow inspection can be replaced by a new configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-recovery-'))
  let release
  try {
    const path = await directory(root)
    const initial = [{ name: SERVICE, enabled: true, config: serviceConfig({ ...DEFAULT_SETTINGS, directories: [join(root, 'missing')] }), updatedAt: 1, credentialsMissing: false, check: null }]
    let calls = 0
    const gate = new Promise(resolve => { release = resolve })
    const f = await fixture({ initial, gate: () => ++calls === 1 ? gate : Promise.resolve() })
    await until(async () => (await f.invoke('servers.list')).data.preparation.state === 'failed')
    const ready = f.messages.findIndex(message => message.type === 'service.ready')
    expect(f.messages.slice(0, ready).some(message => message.type === 'host.request')).toBe(false)
    await f.invoke('servers.save', { ...DEFAULT_SETTINGS, directories: [path] })
    await until(async () => (await f.invoke('servers.list')).data.preparation.state === 'connecting')
    await Promise.all([f.invoke('servers.inspect'), f.invoke('servers.inspect')])
    expect(calls).toBe(1)
    await f.invoke('servers.save', { ...DEFAULT_SETTINGS, directories: [path], disabledTools: ['fixture'] })
    release()
    await until(async () => (await f.invoke('servers.list')).data.preparation.state === 'ready')
    expect(f.messages.some(message => message.type === 'host.cancel')).toBe(true)
    expect((await f.invoke('servers.list')).data.settings.disabledTools).toEqual(['fixture'])
  } finally { release?.(); await rm(root, { recursive: true, force: true }) }
})
