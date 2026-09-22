import {
  AppBackendClient,
  AGENT_BACKEND_EVENTS,
  type AppBackendContext,
  type AgentBackendEvent,
  type AgentHostMethod,
} from '@moss/app-sdk'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

type AgentEvent = {
  version: number
  id: string
  type: string
  timestamp: number
  payload?: unknown
}

export type FeishuAgentBridgeEventHandler = (
  payload: any,
  event: AgentEvent,
) => void | Promise<void>

type FeishuAgentBridgeOptions = {
  clientOptions?: Record<string, unknown>
  onShutdown?: (context: AppBackendContext | null) => void | Promise<void>
}

/**
 * Feishu transport facade over moss.agent/v1.
 */
export class FeishuAgentBridge {
  private client: AppBackendClient
  private handlers = new Map<string, Set<FeishuAgentBridgeEventHandler>>()
  private eventSubscriptions = new Map<string, () => void>()
  private contextValue: AppBackendContext | null = null
  private initializePromise: Promise<AppBackendContext>
  private resolveInitialize!: (context: AppBackendContext) => void
  private rejectInitialize!: (error: Error) => void
  private startupPromise: Promise<void>
  private resolveStartup!: () => void
  private rejectStartup!: (error: Error) => void
  private startupSettled = false
  private destroyed = false

  constructor(options: FeishuAgentBridgeOptions = {}) {
    this.initializePromise = new Promise((resolve, reject) => {
      this.resolveInitialize = resolve
      this.rejectInitialize = reject
    })
    this.startupPromise = new Promise((resolve, reject) => {
      this.resolveStartup = resolve
      this.rejectStartup = reject
    })
    this.client = new AppBackendClient({
      ...(options.clientOptions || {}),
      onInitialize: async (context: AppBackendContext) => {
        this.contextValue = context
        this.resolveInitialize(context)
        await this.startupPromise
      },
      onShutdown: async () => {
        await options.onShutdown?.(this.contextValue)
        this.destroy()
      },
      onFatalError: (error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        this.rejectInitialize(normalized)
        console.error('[FeishuHostBridge] Fatal App Backend error:', normalized)
        setImmediate(() => process.exit(1))
      },
    })
    this.client.start()
  }

  get available(): boolean {
    return !this.destroyed && typeof process.send === 'function' && process.connected !== false
  }

  get context(): AppBackendContext | null {
    return this.contextValue
  }

  async hello(): Promise<AppBackendContext> {
    if (!this.available) throw new Error('Moss App Agent bridge is unavailable.')
    const context = await this.initializePromise
    if (context.appId !== 'moss.feishu') {
      throw new Error('Moss App Agent bridge identity mismatch.')
    }
    return context
  }

  requestAgent(method: string, payload: unknown = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<any> {
    if (!this.available) return Promise.reject(new Error('Moss App Agent bridge is unavailable.'))
    return this.client.requestAgentHost(method as any, payload as any, { timeoutMs })
  }

  registerAction(name: string, handler: (input: any) => unknown | Promise<unknown>): void {
    this.client.registerAction(name, handler)
  }

  status(state: string, details?: Record<string, unknown>): void {
    this.client.status(state, details)
  }

  ready(): void {
    if (this.startupSettled) return
    this.startupSettled = true
    this.resolveStartup()
  }

  fail(error: unknown): void {
    if (this.startupSettled) return
    this.startupSettled = true
    this.rejectStartup(error instanceof Error ? error : new Error(String(error)))
  }

  on(type: string, handler: FeishuAgentBridgeEventHandler): () => void {
    if (!(AGENT_BACKEND_EVENTS as readonly string[]).includes(type)) {
      throw new Error(`Unsupported Moss App Agent event: ${type}`)
    }
    const entries = this.handlers.get(type) ?? new Set<FeishuAgentBridgeEventHandler>()
    entries.add(handler)
    this.handlers.set(type, entries)
    if (!this.eventSubscriptions.has(type)) {
      const unsubscribe = this.client.onAgentEvent(type as AgentBackendEvent, async (data, context) => {
        const event: AgentEvent = {
          version: 1,
          id: context.eventId,
          type,
          timestamp: Date.now(),
          payload: data,
        }
        for (const entry of [...(this.handlers.get(type) || [])]) {
          await entry(data, event)
        }
        return { handled: true }
      })
      this.eventSubscriptions.set(type, unsubscribe)
    }
    return () => {
      entries.delete(handler)
      if (entries.size > 0) return
      this.handlers.delete(type)
      this.eventSubscriptions.get(type)?.()
      this.eventSubscriptions.delete(type)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.fail(new Error('Moss App Agent bridge closed before startup completed.'))
    for (const unsubscribe of this.eventSubscriptions.values()) unsubscribe()
    this.eventSubscriptions.clear()
    this.handlers.clear()
    ;(this.client as AppBackendClient & { closeHost: () => void }).closeHost()
  }
}
