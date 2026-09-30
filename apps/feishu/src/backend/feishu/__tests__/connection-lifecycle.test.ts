import { describe, expect, it } from 'bun:test'
import { createFeishuConnectionLifecycle } from '../connection-lifecycle.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Feishu connection lifecycle', () => {
  it('reports an offline first connection and later recovery without failing startup', async () => {
    const reports: Array<{ connected: boolean; error?: unknown }> = []
    const lifecycle = createFeishuConnectionLifecycle((connected, error) => { reports.push({ connected, error }) })
    lifecycle.onError(new Error('Network is offline'))
    lifecycle.onReconnecting()
    lifecycle.onReady()
    await tick()
    expect(reports).toEqual([
      { connected: false, error: expect.any(Error) },
      { connected: false, error: 'Feishu WebSocket reconnecting' },
      { connected: true, error: undefined },
    ])
  })

  it('preserves connection report order when a previous report is still pending', async () => {
    let acknowledge!: () => void
    const reports: boolean[] = []
    const lifecycle = createFeishuConnectionLifecycle(connected => {
      reports.push(connected)
      if (reports.length === 1) return new Promise<void>(resolve => { acknowledge = resolve })
    })
    lifecycle.onReady()
    lifecycle.onReconnecting()
    lifecycle.onReconnected()
    await tick()
    expect(reports).toEqual([true])
    acknowledge()
    await tick()
    expect(reports).toEqual([true, false, true])
  })

  it('continues reporting after the Host temporarily rejects a status update', async () => {
    const reports: boolean[] = []
    const lifecycle = createFeishuConnectionLifecycle(connected => {
      reports.push(connected)
      if (reports.length === 1) throw new Error('Host temporarily unavailable')
    })
    lifecycle.onError(new Error('offline'))
    lifecycle.onReady()
    lifecycle.onReconnecting()
    lifecycle.onReconnected()
    await tick()
    expect(reports).toEqual([false, true, false, true])
  })
})
