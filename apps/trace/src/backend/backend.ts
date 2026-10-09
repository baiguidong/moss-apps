import { AppBackendClient } from '@moss/app-sdk'
import { createResultTransport } from '@moss/app-sdk/results/store'
export { createResultTransport } from '@moss/app-sdk/results/store'
import { createTraceStore, type TraceInput } from './store'
import { closeTraceStore } from './api/traceStore'

export function createTraceBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  const transfer = createResultTransport()
  const backend = new AppBackendClient({ ...options, onShutdown: async () => {
    transfer.close(); closeTraceStore()
  } })
  for (const method of ['traces.list', 'traces.get', 'traces.call', 'traces.revision', 'traces.delete']) {
    backend.registerAction(method, async (input: unknown, context) => {
      const store = createTraceStore(context.dataDir)
      const value = await store.request(method, input as TraceInput)
      if (method === 'traces.list') {
        const status = await backend.host.request('moss.trace/v1', 'status', {})
        Object.assign(value, { captureStatus: status })
      }
      return transfer.pack(value)
    })
  }
  backend.registerAction('status.get', () => backend.host.request('moss.trace/v1', 'status', {}))
  backend.registerAction('result.read', (input: unknown) => transfer.read(input as { id: string; offset: number }))
  backend.registerAction('result.release', (input: unknown) => transfer.release((input as { id: string }).id))
  return backend
}
