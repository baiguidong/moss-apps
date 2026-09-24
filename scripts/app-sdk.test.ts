import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  AppBackendClient,
  APP_ERROR_CODES,
  APP_HOST_API_VERSION,
  compileJsonSchema,
  createEnvelope,
  resolveBackendProtocols,
  validateAccountHostOutput,
  validateAppManifest,
  type AppServiceEnvelope,
} from '@moss/app-sdk'
import {
  createCloudStorageClient,
  MOSS_CLOUD_STORAGE_PROTOCOL,
  validateCloudStorageHostInput,
  type CloudFile,
} from '@moss/app-sdk/cloud-storage'
import { MOSS_PLATFORM_PROTOCOL } from '@moss/app-sdk/platform'

async function backendHarness(protocols: string[], grants: string[] = []) {
  const sent: AppServiceEnvelope<Record<string, unknown>>[] = []
  let receive: (message: AppServiceEnvelope) => void = () => {}
  const client = new AppBackendClient({
    send: (message: AppServiceEnvelope<Record<string, unknown>>) => { sent.push(message) },
    onMessage: (handler: typeof receive) => { receive = handler },
    onDisconnect: () => {},
  }).start()
  async function send(type: string, payload: Record<string, unknown>, id?: string) {
    receive(createEnvelope(type, { ...payload, generation: 1, launchToken: 'test-launch' }, { id }))
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  await send('service.init', {
    appId: 'example.drive', version: '0.1.0', instanceId: 'example.drive--default',
    config: {}, secrets: {}, protocols, grants,
    permissions: ['cloud-storage:read', 'cloud-storage:write', 'platform:files'],
  })
  async function reply(result: unknown) {
    const request = sent.findLast(message => message.type === 'host.request')!
    await send('host.response', {
      protocol: request.payload.protocol, requestId: request.id, ok: true, result,
    })
  }
  return { client, sent, send, reply }
}

describe('SDK 2.2 consumer contract', () => {
  it('loads the public entry points in the Node Backend runtime', () => {
    const output = execFileSync('node', [
      '--input-type=module', '-e', `
        import * as sdk from '@moss/app-sdk'
        import * as cloud from '@moss/app-sdk/cloud-storage'
        import * as platform from '@moss/app-sdk/platform'
        console.log(JSON.stringify({
          version: sdk.APP_HOST_API_VERSION,
          cloud: cloud.MOSS_CLOUD_STORAGE_PROTOCOL,
          platform: platform.MOSS_PLATFORM_PROTOCOL,
          sameExports: sdk.createCloudStorageClient === cloud.createCloudStorageClient,
        }))
      `,
    ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual({
      version: '2.2.0', cloud: MOSS_CLOUD_STORAGE_PROTOCOL,
      platform: MOSS_PLATFORM_PROTOCOL, sameExports: true,
    })
  })

  it('accepts a cloud App and enforces its minimum Host version', () => {
    const source = {
      schemaVersion: 2, id: 'example.drive', version: '0.1.0', displayName: 'Drive',
      hostApi: '^2.2.0', permissions: ['cloud-storage:read', 'cloud-storage:write'],
      backend: {
        entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'persistent',
        protocols: [MOSS_CLOUD_STORAGE_PROTOCOL], actions: [{ name: 'files.list' }],
      },
    }
    const manifest = validateAppManifest(source)
    expect(manifest.hostApi).toBe(`^${APP_HOST_API_VERSION}`)
    const protocols = resolveBackendProtocols(manifest.backend)
    protocols.push(MOSS_PLATFORM_PROTOCOL)
    expect(manifest.backend?.protocols).toEqual([MOSS_CLOUD_STORAGE_PROTOCOL])
    expect(() => validateAppManifest(source, { hostApiVersion: '2.1.0' }))
      .toThrow(/requires Host API/)
  })

  it('lists cloud files and creates uploads and downloads through Backend IPC', async () => {
    const h = await backendHarness([MOSS_CLOUD_STORAGE_PROTOCOL], ['cloud-storage:read', 'cloud-storage:write'])
    const cloud = createCloudStorageClient(h.client.host)
    const file: CloudFile = {
      id: 'file-1', parentId: null, name: 'report.pdf', kind: 'file',
      size: 1024, revision: 'revision-1', createdAt: 1, updatedAt: 1,
    }

    const listing = cloud.request('files.list', { parentId: null, limit: 100 })
    expect(h.sent.at(-1)?.payload).toMatchObject({
      protocol: MOSS_CLOUD_STORAGE_PROTOCOL, method: 'files.list',
      input: { parentId: null, limit: 100 }, generation: 1, launchToken: 'test-launch',
    })
    await h.reply({ files: [file], nextCursor: 'next-page' })
    expect(await listing).toEqual({ files: [file], nextCursor: 'next-page' })

    const selection = cloud.request('local-files.pick')
    await h.reply({ files: [{ handle: 'selected-file', name: file.name, size: file.size }] })
    const { files } = await selection
    const upload = cloud.request('uploads.start', { handle: files[0].handle, parentId: null })
    expect(h.sent.at(-1)?.payload.input).toEqual({ handle: 'selected-file', parentId: null })
    await h.reply({ transferId: 'upload-1' })
    expect(await upload).toEqual({ transferId: 'upload-1' })

    const download = cloud.request('downloads.start', { fileId: file.id })
    expect(h.sent.at(-1)?.payload.input).toEqual({ fileId: 'file-1' })
    await h.reply({ transferId: 'download-1' })
    expect(await download).toEqual({ transferId: 'download-1' })
  })

  it('delivers cloud progress events and stops delivering after unsubscribe', async () => {
    const h = await backendHarness([MOSS_CLOUD_STORAGE_PROTOCOL], ['cloud-storage:read'])
    const cloud = createCloudStorageClient(h.client.host)
    const progress: unknown[] = []
    const stop = cloud.on('transfers.progress', data => { progress.push(data) })
    const data = { transferId: 'upload-1', transferredBytes: 128, totalBytes: 1024 }
    await h.send('host.event', {
      protocol: MOSS_CLOUD_STORAGE_PROTOCOL, name: 'transfers.progress', eventId: 'event-1', data,
    })
    expect(progress).toEqual([data])
    expect(h.sent.at(-1)).toMatchObject({ type: 'host.event.response', payload: { ok: true, eventId: 'event-1' } })
    stop()
    await h.send('host.event', {
      protocol: MOSS_CLOUD_STORAGE_PROTOCOL, name: 'transfers.progress', eventId: 'event-2', data,
    })
    expect(progress).toHaveLength(1)
    expect(h.sent.at(-1)).toMatchObject({ type: 'host.event.response', payload: { ok: false, eventId: 'event-2' } })
  })

  it('rejects undeclared cloud access, raw paths, identity overrides and invalid Host results', async () => {
    const unavailable = await backendHarness([])
    await expect(createCloudStorageClient(unavailable.client.host).request('files.list'))
      .rejects.toMatchObject({ code: APP_ERROR_CODES.hostUnavailable })
    expect(unavailable.sent.some(message => message.type === 'host.request')).toBe(false)
    for (const field of ['path', 'userId', 'orgId', 'appId', 'bucket', 'objectKey']) {
      expect(() => validateCloudStorageHostInput('uploads.start', { handle: 'file', [field]: 'injected' })).toThrow()
    }
    expect(() => validateCloudStorageHostInput('files.list', { limit: 201 })).toThrow()

    const h = await backendHarness([MOSS_CLOUD_STORAGE_PROTOCOL], ['cloud-storage:read'])
    const pending = createCloudStorageClient(h.client.host).request('files.list')
    const outcome = pending.then(result => result, error => error)
    await h.reply({ files: [{ name: 'missing-metadata' }], nextCursor: null })
    expect(await outcome).toMatchObject({ code: APP_ERROR_CODES.hostProtocol })
  })

  it('uses Platform permissions and dispatches the renamed client API', async () => {
    const denied = await backendHarness([MOSS_PLATFORM_PROTOCOL])
    expect(() => denied.client.platform.request('file.pick', {}))
      .toThrow(/permission grant: platform:files/)
    expect(denied.sent.some(message => message.type === 'host.request')).toBe(false)

    const h = await backendHarness([MOSS_PLATFORM_PROTOCOL], ['platform:files'])
    const pending = h.client.platform.request('file.pick', { kind: 'file', multiple: true })
    expect(h.sent.at(-1)?.payload).toMatchObject({
      protocol: MOSS_PLATFORM_PROTOCOL, method: 'file.pick', input: { kind: 'file', multiple: true },
    })
    await h.reply({ files: [] })
    expect(await pending).toEqual({ files: [] })
  })

  it('accepts the current Account identity contract', () => {
    expect(validateAccountHostOutput('identity.current', { user: null })).toEqual({ user: null })
    expect(() => validateAccountHostOutput('identity.current', { user: null, source: 'local' })).toThrow(/source/)
  })

  it('only strips extra action input properties when explicitly requested', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false }
    const source = { name: 'report.pdf', extra: true }
    expect(compileJsonSchema(schema)(source)).toBe(false)
    expect(source.extra).toBe(true)
    const cleaned: { name: string; extra?: boolean } = { ...source }
    expect(compileJsonSchema(schema, { removeAdditional: true })(cleaned)).toBe(true)
    expect(cleaned).toEqual({ name: 'report.pdf' })
  })
})
