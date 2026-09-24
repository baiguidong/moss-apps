import type { AppUiApi } from '@moss/app-sdk'
import type { ActionResult, CloudEvent, DriveApi, DriveMethod, Input, Output, RuntimeStatus } from '../contracts'
import { actionTimeout } from '../contracts'
import { DriveError } from './errors'

declare global { interface Window { mossApp?: AppUiApi } }

export function createHostApi(bridge: AppUiApi): DriveApi {
  let instance: Promise<string> | undefined
  let disposed = false
  const pending = new Map<string, string>()
  const resolveInstance = () => instance ??= bridge.instances.list().then(instances => {
    const item = instances[0]
    if (!item?.id) throw new DriveError('HOST_UNAVAILABLE')
    return String(item.id)
  }).catch(error => { instance = undefined; throw error })
  return {
    demo: false,
    async request<M extends DriveMethod>(method: M, input: Input<M>): Promise<Output<M>> {
      const id = await resolveInstance()
      if (disposed) throw new DriveError('APP_ACTION_CANCELED')
      const requestId = crypto.randomUUID()
      pending.set(requestId, id)
      try {
        const response = await bridge.actions.invoke<ActionResult<Output<M>>>(id, method, input, { requestId, timeoutMs: actionTimeout(method) })
        if (!response?.ok) throw new DriveError(response?.error?.code || 'REQUEST_FAILED', response?.error?.message)
        return response.data
      } finally { pending.delete(requestId) }
    },
    async runtime(): Promise<RuntimeStatus> {
      const installation = await bridge.app.getInstallationState()
      const record = installation?.installation as { enabled?: boolean } | undefined
      if (!record?.enabled) return { state: 'disabled' }
      const status = await bridge.instances.getStatus(await resolveInstance())
      return { state: String(status?.state || 'stopped'), error: typeof status?.lastError === 'string' ? status.lastError : undefined }
    },
    onCloud: callback => bridge.events.on('cloud.event', event => {
      const e = event as CloudEvent
      if (e && ['transfers.progress', 'transfers.changed', 'storage.status-changed'].includes(e.name) && e.data) callback(e)
    }),
    onRuntime: callback => bridge.events.on('runtime', event => {
      const e = event as { type?: string }
      if (['status', 'installation-changed', 'app-uninstalled'].includes(e?.type || '')) callback()
    }),
    dispose() {
      disposed = true
      for (const [requestId, id] of pending) void bridge.actions.cancel(id, requestId).catch(() => {})
      pending.clear()
    },
  }
}
