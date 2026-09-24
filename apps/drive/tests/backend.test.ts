import { expect, test } from 'bun:test'
import { createEnvelope, compileJsonSchema, type AppServiceEnvelope } from '@moss/app-sdk'
import { createDriveBackend } from '../src/backend/backend'
import manifest from '../app.moss.json'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const identity = { appId: 'moss.drive', instanceId: 'default', generation: 'test-generation' }
async function fixture(respond: (method: string, input: any) => any = () => ({ state: 'ready' })) {
  const messages: AppServiceEnvelope<any>[] = []
  let response = respond
  const client = createDriveBackend({ send: (message: AppServiceEnvelope<any>) => {
    messages.push(message)
    if (message.type === 'host.request') {
      void Promise.resolve().then(async () => {
        try {
          const result = await response(message.payload.method, message.payload.input)
          await client.handleMessage(createEnvelope('host.response', { ...identity, protocol: 'moss.cloud-storage/v1', ok: true, result }, { id: message.id }))
        } catch (error: any) {
          await client.handleMessage(createEnvelope('host.response', { ...identity, protocol: 'moss.cloud-storage/v1', ok: false, error: { code: error.code || 'REQUEST_FAILED', message: error.message } }, { id: message.id }))
        }
      })
    }
  } })
  await client.handleMessage(createEnvelope('service.init', { ...identity, protocols: manifest.backend.protocols, permissions: manifest.permissions, grants: manifest.permissions }))
  return { client, messages, setResponse: (fn: typeof respond) => { response = fn }, async invoke(name: string, input = {}) {
    const envelope = createEnvelope('action.invoke', { name, input })
    await client.handleMessage(envelope)
    return messages.find(message => message.id === envelope.id && ['action.result', 'action.error'].includes(message.type))!
  } }
}

test('backend exposes only declared actions and forwards validated Host requests', async () => {
  const f = await fixture()
  const result = await f.invoke('status.get')
  expect(result.payload.result).toEqual({ ok: true, data: { state: 'ready' } })
  expect(f.messages.find(v => v.type === 'host.request')?.payload).toMatchObject({ protocol: 'moss.cloud-storage/v1', method: 'status.get', input: {} })
  const invalid = await f.invoke('files.list', { limit: 201 })
  expect(invalid.payload.result.ok).toBe(false)
  expect(f.messages.filter(v => v.type === 'host.request')).toHaveLength(1)
  expect((await f.invoke('files.update', { fileId: 'any', name: 'renamed' })).type).toBe('action.error')
})

test('error envelopes preserve cancellation and conflict codes; outputs match published schema', async () => {
  const f = await fixture(() => { throw Object.assign(new Error('Save was cancelled'), { code: 'CANCELLED' }) })
  const result = (await f.invoke('downloads.start', { fileId: 'file' })).payload.result
  expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
  const schema = JSON.parse(readFileSync(resolve(import.meta.dir, '../schemas/downloads.start.output.json'), 'utf8'))
  const validate = compileJsonSchema(schema)
  expect(validate(result)).toBe(true)
  f.setResponse(() => ({ transferId: 'created' }))
  expect(validate((await f.invoke('downloads.start', { fileId: 'file' })).payload.result)).toBe(true)
})

test('backend rejects malformed Host output and forwards storage events to UI', async () => {
  const f = await fixture(() => ({ files: [], nextCursor: 42 }))
  expect((await f.invoke('files.list')).payload.result.ok).toBe(false)
  await f.client.handleMessage(createEnvelope('host.event', { ...identity, protocol: 'moss.cloud-storage/v1', name: 'storage.status-changed', data: { state: 'unauthenticated' } }))
  expect(f.messages.some(v => v.type === 'event.emit' && v.payload.name === 'cloud.event' && v.payload.data.data.state === 'unauthenticated')).toBe(true)
})

test('action cancellation reaches pending native dialogs through Host cancellation', async () => {
  const f = await fixture(() => new Promise(() => {}))
  const invoke = createEnvelope('action.invoke', { name: 'local-files.pick', input: {} })
  const pending = f.client.handleMessage(invoke)
  await Promise.resolve()
  await f.client.handleMessage(createEnvelope('action.cancel', { requestId: invoke.id }))
  await pending
  expect(f.messages.some(v => v.type === 'host.cancel')).toBe(true)
  expect(f.messages.find(v => v.type === 'action.result')?.payload.result).toMatchObject({ ok: false, error: { code: 'APP_ACTION_CANCELED' } })
})

test('directory creation and deletion validate inputs, responses and error codes', async () => {
  const folder = { id: 'new', parentId: null, name: '文档', kind: 'folder', size: 0, revision: '1', createdAt: 1, updatedAt: 1 }
  const f = await fixture(method => method === 'folders.create' ? folder : { ok: true })
  expect((await f.invoke('folders.create', { name: '文档', parentId: null })).payload.result).toEqual({ ok: true, data: folder })
  expect((await f.invoke('files.delete', { fileId: 'file' })).payload.result).toEqual({ ok: true, data: { ok: true } })
  const requests = f.messages.filter(message => message.type === 'host.request').length
  expect((await f.invoke('files.delete')).payload.result.ok).toBe(false)
  expect((await f.invoke('folders.create', { name: '' })).payload.result.ok).toBe(false)
  expect(f.messages.filter(message => message.type === 'host.request')).toHaveLength(requests)
  f.setResponse(() => ({ ok: false }))
  expect((await f.invoke('files.delete', { fileId: 'file' })).payload.result.error.code).toBe('APP_HOST_PROTOCOL')
  f.setResponse(() => { throw Object.assign(new Error('No deletion grant'), { code: 'PERMISSION_DENIED' }) })
  expect((await f.invoke('files.delete', { fileId: 'file' })).payload.result.error.code).toBe('PERMISSION_DENIED')
  expect(manifest.permissions).toContain('cloud-storage:delete')
})
