import { randomUUID } from 'node:crypto'

const BRIDGE_VERSION = 1
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

type BridgeResponse = {
  version: number
  replyTo: string
  ok: boolean
  result?: unknown
  error?: { code?: string; message?: string }
}

type BridgeEvent = {
  version: number
  id: string
  type: string
  timestamp: number
  payload?: unknown
}

type PendingRequest = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type ProcessBridgeEventHandler = (payload: any, event: BridgeEvent) => void | Promise<void>

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export class ProcessBridge {
  private pending = new Map<string, PendingRequest>()
  private handlers = new Map<string, Set<ProcessBridgeEventHandler>>()
  private destroyed = false

  constructor() {
    process.on('message', this.handleMessage)
    if (typeof process.send === 'function') {
      process.once('disconnect', this.handleDisconnect)
    }
  }

  get available(): boolean {
    return !this.destroyed && typeof process.send === 'function' && process.connected !== false
  }

  async hello(payload: Record<string, unknown>): Promise<any> {
    return this.request('bridge.hello', payload)
  }

  request(type: string, payload: unknown = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<any> {
    if (!this.available) {
      return Promise.reject(new Error('Moss Desktop process bridge is unavailable.'))
    }
    const id = randomUUID()
    const message: BridgeEvent = {
      version: BRIDGE_VERSION,
      id,
      type,
      timestamp: Date.now(),
      payload,
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Moss Desktop request timed out: ${type}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      process.send!(message, (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  on(type: string, handler: ProcessBridgeEventHandler): () => void {
    const entries = this.handlers.get(type) ?? new Set<ProcessBridgeEventHandler>()
    entries.add(handler)
    this.handlers.set(type, entries)
    return () => {
      entries.delete(handler)
      if (entries.size === 0) this.handlers.delete(type)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    process.off('message', this.handleMessage)
    process.off('disconnect', this.handleDisconnect)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Moss Desktop process bridge closed.'))
    }
    this.pending.clear()
    this.handlers.clear()
  }

  private handleMessage = (value: unknown): void => {
    if (!isRecord(value) || value.version !== BRIDGE_VERSION) return
    if (typeof value.replyTo === 'string') {
      const pending = this.pending.get(value.replyTo)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(value.replyTo)
      const response = value as BridgeResponse
      if (response.ok) {
        pending.resolve(response.result)
      } else {
        pending.reject(new Error(response.error?.message || 'Moss Desktop request failed.'))
      }
      return
    }
    if (typeof value.type !== 'string' || typeof value.id !== 'string') return
    const event = value as BridgeEvent
    const handlers = [...(this.handlers.get(event.type) ?? [])]
    for (const handler of handlers) {
      void Promise.resolve(handler(event.payload, event)).catch((error) => {
        console.error(`[ProcessBridge] ${event.type} handler failed:`, error)
      })
    }
  }

  private handleDisconnect = (): void => {
    this.destroy()
    setImmediate(() => process.exit(0))
  }
}
