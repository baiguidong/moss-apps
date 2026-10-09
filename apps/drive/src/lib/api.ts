import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { ActionResult, CloudEvent, DriveApi, DriveMethod, Input, Output, RuntimeStatus } from '../contracts'
import { actionTimeout } from '../contracts'
import { DriveError } from './errors'

declare global { interface Window { mossApp?: AppUiApi } }

export function createHostApi(bridge: AppUiApi): DriveApi {
  const client = createAppClient(bridge)
  let disposed = false
  return {
    demo: false,
    async request<M extends DriveMethod>(method: M, input: Input<M>): Promise<Output<M>> {
      if (disposed) throw new DriveError('APP_ACTION_CANCELED')
      const requestId = crypto.randomUUID()
      {
        const response = await client.actions.invoke<ActionResult<Output<M>>>(method, input, { requestId, timeoutMs: actionTimeout(method) })
        if (!response?.ok) throw new DriveError(response?.error?.code || 'REQUEST_FAILED', response?.error?.message)
        return response.data
      }
    },
    async runtime(): Promise<RuntimeStatus> {
      const installation = await bridge.app.getInstallationState()
      const record = installation?.installation as { enabled?: boolean } | undefined
      if (!record?.enabled) return { state: 'disabled' }
      const status = await bridge.app.getStatus()
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
      client.dispose()
    },
  }
}
