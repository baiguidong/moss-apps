import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import type { AppUiApi } from '@moss/app-sdk'
import { send } from '../../src/http/lib/host'
import { emptyRequest } from '../../src/http/contracts'
import { createTestServer } from './fixtures.mjs'
import manifest from '../../app.moss.json'

const core = path.resolve(process.env.MOSS_CORE_ROOT || '../../vendor/moss-core')
const { AppRuntimeHost, writePackageChecksums, defaultInstanceId } = await import(pathToFileURL(path.join(core, 'packages/app-runtime/src/index.mjs')).href)
const appId = 'moss.devtools', instanceId = defaultInstanceId(appId)
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function waitFor(predicate: () => boolean) {
  // Windows process identity checks can take several seconds on a cold runner.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Timed out')
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'http-host-'))
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  await fs.copyFile(process.env.MOSS_HTTP_TEST_BACKEND!, path.join(source, 'main.mjs'))
  await fs.cp(path.resolve('schemas'), path.join(source, 'schemas'), { recursive: true })
  await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
    ...manifest, ui: undefined, icon: undefined, contributes: undefined,
    backend: { ...manifest.backend, entry: 'main.mjs' },
  }))
  await writePackageChecksums(source)
  const runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'runtime'), nodeExecutable: process.execPath }).initialize()
  await runtime.installFromDirectory(source)
  const server = await createTestServer()
  const oldWindow = globalThis.window
  let cancels = 0, invokes = 0, changes = 0
  const windowStub = new EventTarget() as EventTarget & { mossApp: AppUiApi }
  windowStub.mossApp = {
    instances: { list: async () => [{ id: instanceId }] },
    actions: {
      invoke: async (name: string, input: unknown, options: unknown) => { invokes++; try { return { ok: true, result: await runtime.invoke(appId, instanceId, name, input, options) } } catch (error: any) { return { ok: false, error: { code: error.code, message: error.message } } } },
      cancel: async (requestId: string) => { cancels++; return { cancelled: runtime.cancel(appId, instanceId, requestId) } },
    },
  } as unknown as AppUiApi
  windowStub.addEventListener('devtools-operation', () => { changes++ })
  globalThis.window = windowStub as unknown as Window & typeof globalThis
  return { runtime, server, counters: () => ({ cancels, invokes, changes }), close: async () => {
    globalThis.window = oldWindow
    await runtime.shutdown(); await server.close(); await fs.rm(root, { recursive: true, force: true })
  } }
}

for (const phase of ['getActivePackage', 'prepareRuntime', 'network']) test(`one UI cancellation is enough during ${phase}`, async () => {
  const f = await setup(), entered = deferred(), release = deferred()
  const original = phase === 'network' ? null : f.runtime[phase].bind(f.runtime)
  let pending: Promise<unknown> | undefined
  try {
    if (original) f.runtime[phase] = async (...args: unknown[]) => { entered.resolve(); await release.promise; return original(...args) }
    const controller = new AbortController()
    pending = send({ ...emptyRequest(), url: `${f.server.url}/slow` }, controller.signal).catch(error => error)
    if (original) await entered.promise; else await waitFor(() => f.server.requests.length === 1)
    controller.abort()
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('cancel timed out'), 500))])
    assert.ok(result instanceof Error)
    assert.equal((result as any).code, 'APP_ACTION_CANCELED')
    release.resolve()
    await waitFor(() => f.runtime.actions.pendingTotal === 0)
    if (original) {
      assert.equal(f.server.requests.length, 0)
      assert.equal(f.runtime.supervisor.processes.size, 0)
    } else await waitFor(() => f.server.closedSlowRequests() === 1)
    assert.deepEqual(f.counters(), { cancels: 1, invokes: 1, changes: 1 })
  } finally { release.resolve(); if (original) f.runtime[phase] = original; await pending; await f.close() }
})

test('completed requests remove the abort listener; pre-cancelled requests never invoke Backend', async () => {
  const f = await setup()
  try {
    const controller = new AbortController()
    const result = await send({ ...emptyRequest(), url: `${f.server.url}/echo` }, controller.signal)
    assert.equal(result.status, 200)
    controller.abort()
    await assert.rejects(send({ ...emptyRequest(), url: `${f.server.url}/echo` }, controller.signal), { code: 'APP_ACTION_CANCELED' })
    assert.deepEqual(f.counters(), { cancels: 0, invokes: 1, changes: 2 })
  } finally { await f.close() }
})
