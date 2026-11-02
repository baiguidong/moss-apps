import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startBackend } from '../packages/engine-apps/src/backend.mjs'

const turn = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture(engine) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-engine-backend-'))
  const actions = new Map(), events = []
  let options
  class Client {
    constructor(value) { options = value }
    registerAction(name, handler) { actions.set(name, handler) }
    emit(name, data) { events.push({ name, data }) }
    start() {}
  }
  startBackend({ id: 'fixture', spec: { version: '1' }, catalog: async () => ({ tools: [] }), ...engine },
    path.join(dataDir, 'worker.mjs'), { Client })
  return {
    actions, events,
    initialize: () => options.onInitialize({ dataDir, protocols: ['moss.artifacts/v1'] }),
    invoke: (name, input = {}) => actions.get(name)(input),
    shutdown: () => options.onShutdown(),
    async cleanup() { await options.onShutdown(); await fs.rm(dataDir, { recursive: true, force: true }) },
  }
}

test('required actions are registered before initialization completes', async () => {
  const registration = deferred()
  const f = await fixture({ async register(backend) {
    await registration.promise
    backend.registerAction('fixture.read', async () => ({ ready: true }))
  } })
  let initialized = false
  const pending = f.initialize().then(() => { initialized = true })
  try {
    await turn()
    assert.equal(initialized, false)
    registration.resolve()
    await pending
    assert.deepEqual(await f.invoke('fixture.read'), { ready: true })
  } finally { registration.resolve(); await pending; await f.cleanup() }
})

test('required registration failures still reject initialization', async () => {
  let activated = false
  const f = await fixture({
    register() { throw new Error('Invalid action configuration') },
    activate() { activated = true },
  })
  try {
    await assert.rejects(f.initialize(), /Invalid action configuration/)
    await turn()
    assert.equal(activated, false)
  } finally { await f.cleanup() }
})

test('unavailable external services leave saved work accessible and can be retried', async () => {
  const connection = deferred()
  let attempts = 0
  const f = await fixture({ async activate() {
    if (++attempts === 1) await connection.promise
  } })
  try {
    await f.initialize()
    assert.equal(attempts, 0, 'external services start after the handshake')
    await turn()
    assert.equal(attempts, 1)
    assert.deepEqual((await f.invoke('workspace.get')).tasks, [])
    connection.reject(new Error('MCP service unavailable'))
    await turn()
    assert.equal((await f.invoke('workspace.get')).registrationError, 'MCP service unavailable')
    assert(f.events.some(event => event.name === 'workspace.changed'), 'the UI must receive the failure')
    assert.deepEqual(await f.invoke('engine.prepare'), { tools: [] })
    assert.equal(attempts, 2)
    assert.equal((await f.invoke('workspace.get')).registrationError, '')
  } finally { connection.resolve(); await f.cleanup() }
})

test('shutdown waits for external activation before closing the engine', async () => {
  const connection = deferred()
  let closed = false
  const f = await fixture({ activate: () => connection.promise, close() { closed = true } })
  try {
    await f.initialize()
    await turn()
    const shutdown = f.shutdown()
    await turn()
    assert.equal(closed, false)
    connection.resolve()
    await shutdown
    assert.equal(closed, true)
    assert.deepEqual(f.events, [], 'shutdown must not publish late workspace updates')
  } finally { connection.resolve(); await f.cleanup() }
})

test('shutdown before deferred startup prevents external activation', async () => {
  let activated = false
  const f = await fixture({ activate() { activated = true } })
  try {
    await f.initialize()
    await f.shutdown()
    await turn()
    assert.equal(activated, false)
  } finally { await f.cleanup() }
})
