import { describe, expect, it } from 'bun:test'
import { createFeishuConnectionLifecycle } from '../connection-lifecycle.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Feishu connection lifecycle', () => {
  it('does not become ready until the SDK reports a connection and the Host acknowledges it', async () => {
    let acknowledge!: () => void
    const reports: Array<{ connected: boolean; required?: boolean }> = []
    const lifecycle = createFeishuConnectionLifecycle((connected, _error, required) => {
      reports.push({ connected, required })
      return new Promise<void>((resolve) => { acknowledge = resolve })
    })
    let ready = false
    void lifecycle.initialReady.then(() => { ready = true })

    await tick()
    expect(ready).toBe(false)
    expect(reports).toEqual([])

    lifecycle.onReady()
    await tick()
    expect(ready).toBe(false)
    expect(reports).toEqual([{ connected: true, required: true }])

    acknowledge()
    await lifecycle.initialReady
    expect(ready).toBe(true)
  })

  it('rejects startup when the Host cannot acknowledge the initial connection', async () => {
    const lifecycle = createFeishuConnectionLifecycle(async (_connected, _error, required) => {
      if (required) throw new Error('Host rejected connection')
    })
    lifecycle.onReady()
    await expect(lifecycle.initialReady).rejects.toThrow('Host rejected connection')
  })

  it('reports reconnect state without reopening the initial readiness gate', async () => {
    const reports: Array<{ connected: boolean; error?: unknown; required?: boolean }> = []
    const lifecycle = createFeishuConnectionLifecycle(async (connected, error, required) => {
      reports.push({ connected, error, required })
    })

    lifecycle.onReady()
    await lifecycle.initialReady
    lifecycle.onReconnecting()
    lifecycle.onReconnected()
    lifecycle.onError(new Error('closed'))
    await tick()

    expect(reports).toEqual([
      { connected: true, error: undefined, required: true },
      { connected: false, error: 'Feishu WebSocket reconnecting', required: undefined },
      { connected: true, error: undefined, required: undefined },
      { connected: false, error: expect.any(Error), required: undefined },
    ])
    await expect(lifecycle.initialReady).resolves.toBeUndefined()
  })
})
