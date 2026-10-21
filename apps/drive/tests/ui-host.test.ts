import { expect, test } from 'bun:test'
import { createHostApi } from '../src/lib/api'

test('Drive UI requests and subscribes through Host without Backend actions', async () => {
  const calls: string[] = []
  const events = new Set<(event: any) => void>()
  const subscriptions = new Map<string, string>()
  const bridge: any = {
    app: { getInstallationState: async () => ({ installation: { enabled: true } }) },
    events: { on: () => () => {} },
    host: {
      request: async (protocol: string, method: string) => {
        calls.push(`${protocol}:${method}`)
        return { ok: true, result: method === 'capabilities.get'
          ? { capabilities: [{ protocol: 'moss.cloud-storage/v1', method: 'status.get', available: true }] }
          : { state: 'ready' } }
      },
      subscribe: async (_protocol: string, name: string, id: string) => { subscriptions.set(name, id); return { ok: true, result: { subscriptionId: id } } },
      onEvent: (listener: (event: any) => void) => { events.add(listener); return () => events.delete(listener) },
      unsubscribe: async () => ({}), cancel: async () => ({}),
    },
  }
  const api = createHostApi(bridge)
  try {
    expect(await api.request('status.get', {})).toEqual({ state: 'ready' })
    expect(await api.runtime()).toEqual({ state: 'running', error: undefined })
    expect(calls).toEqual(['moss.cloud-storage/v1:status.get', 'moss.host/v1:capabilities.get'])
    const received: any[] = []
    const off = api.onCloud(event => received.push(event))
    await new Promise(resolve => setTimeout(resolve, 0))
    for (const listener of events) listener({ subscriptionId: subscriptions.get('storage.status-changed'), data: { state: 'ready' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(received).toEqual([{ name: 'storage.status-changed', data: { state: 'ready' } }])
    off()
  } finally { api.dispose() }
})
