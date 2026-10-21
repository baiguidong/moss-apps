import { createAppClient } from '@moss/app-sdk/ui'
import { CLOUD_STORAGE_EVENTS, validateCloudStorageHostInput, validateCloudStorageHostOutput } from '@moss/app-sdk/cloud-storage'
import type { AppUiApi } from '@moss/app-sdk'
import type { CloudEvent, DriveApi, DriveMethod, Input, Output, RuntimeStatus } from '../contracts'
import { actionTimeout } from '../contracts'
import { DriveError } from './errors'

declare global { interface Window { mossApp?: AppUiApi } }

export function createHostApi(bridge: AppUiApi): DriveApi {
  const client = createAppClient(bridge)
  let disposed = false
  const runtimeListeners = new Set<() => void>()
  const notifyRuntime = () => runtimeListeners.forEach(listener => listener())
  return {
    demo: false,
    async request<M extends DriveMethod>(method: M, input: Input<M>): Promise<Output<M>> {
      if (disposed) throw new DriveError('APP_ACTION_CANCELED')
      const validated = validateCloudStorageHostInput(method, input)
      const response = await client.host.request('moss.cloud-storage/v1', method, validated, { timeoutMs: actionTimeout(method) })
      return validateCloudStorageHostOutput(method, response) as Output<M>
    },
    async runtime(): Promise<RuntimeStatus> {
      const installation = await bridge.app.getInstallationState()
      const record = installation?.installation as { enabled?: boolean } | undefined
      if (!record?.enabled) return { state: 'disabled' }
      const { capabilities } = await client.host.request('moss.host/v1', 'capabilities.get', { protocols: ['moss.cloud-storage/v1'] })
      const capability = capabilities.find(item => item.protocol === 'moss.cloud-storage/v1' && item.method === 'status.get')
      return { state: capability?.available ? 'running' : 'error', error: capability?.available ? undefined : capability?.reason || '网盘服务不可用' }
    },
    onCloud: callback => {
      let stopped = false
      const subscriptions = new Map<string, () => void>()
      const timers = new Set<ReturnType<typeof setTimeout>>()
      for (const name of CLOUD_STORAGE_EVENTS) {
        const subscribe = () => {
          if (stopped || disposed) return
          void client.host.subscribe('moss.cloud-storage/v1', name, data => {
            if (!stopped && !disposed) callback({ name, data } as CloudEvent)
          }, { onError: () => { subscriptions.delete(name); notifyRuntime(); retry() } }).then(off => {
            if (stopped || disposed) off()
            else subscriptions.set(name, off)
          }).catch(() => { notifyRuntime(); retry() })
        }
        const retry = () => {
          if (stopped || disposed) return
          const timer = setTimeout(() => { timers.delete(timer); subscribe() }, 1000)
          timers.add(timer)
        }
        subscribe()
      }
      return () => { stopped = true; for (const timer of timers) clearTimeout(timer); for (const off of subscriptions.values()) off(); subscriptions.clear() }
    },
    onRuntime: callback => {
      runtimeListeners.add(callback)
      const off = bridge.events.on('runtime', event => {
      const e = event as { type?: string }
      if (['status', 'installation-changed', 'app-uninstalled'].includes(e?.type || '')) callback()
      })
      return () => { runtimeListeners.delete(callback); off() }
    },
    dispose() {
      disposed = true
      client.dispose()
    },
  }
}
