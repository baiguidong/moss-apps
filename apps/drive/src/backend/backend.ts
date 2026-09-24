import { AppBackendClient, type AppActionContext } from '@moss/app-sdk'
import { createCloudStorageClient, CLOUD_STORAGE_EVENTS, validateCloudStorageHostInput } from '@moss/app-sdk/cloud-storage'
import { validatedResult } from './validation'
import { DRIVE_METHODS, actionTimeout } from '../contracts'

export function createDriveBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  const subscriptions: Array<() => void> = []
  const backend = new AppBackendClient({
    ...options,
    onShutdown: () => subscriptions.forEach(stop => stop()),
  })
  const cloud = createCloudStorageClient(backend.host)
  for (const name of CLOUD_STORAGE_EVENTS) {
    subscriptions.push(cloud.on(name, data => {
      try {
        validatedResult(name === 'storage.status-changed' ? 'status.get' : 'transfers.get', data)
        backend.emit('cloud.event', { name, data })
      } catch { backend.log('warn', 'Ignored malformed cloud storage event') }
    }))
  }
  for (const method of DRIVE_METHODS) {
    backend.registerAction(method, async (raw: unknown, context: AppActionContext) => {
      try {
        const input = validateCloudStorageHostInput(method, raw ?? {})
        const data = await cloud.request(method, input, {
          signal: context.signal,
          timeoutMs: actionTimeout(method) - 1000,
        })
        return validatedResult(method, data)
      } catch (cause) {
        const error = cause as { code?: string; message?: string }
        return { ok: false, error: { code: error.code || 'REQUEST_FAILED', message: error.message || 'Request failed' } }
      }
    })
  }
  return backend
}
