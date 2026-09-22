import { randomUUID } from 'node:crypto'
import {
  AppBackendClient,
  CHANNEL_BACKEND_EVENTS,
  type AppBackendContext,
  type ChannelBackendEvent,
  type ChannelHostMethod,
} from '@moss/app-sdk'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

type TransportPayload = Record<string, any>

type TransportEvent = {
  version: number
  id: string
  type: string
  timestamp: number
  payload?: unknown
}

export type FeishuHostBridgeEventHandler = (
  payload: any,
  event: TransportEvent,
) => void | Promise<void>

type FeishuHostBridgeOptions = {
  clientOptions?: Record<string, unknown>
  createEventId?: () => string
  onShutdown?: (context: AppBackendContext | null) => void | Promise<void>
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function externalIdentity(payload: TransportPayload, createEventId: () => string, requireConversation = false) {
  const externalUserId = asText(payload.externalUserId || payload.openId)
  const externalConversationId = asText(payload.externalConversationId || payload.chatId)
  const externalEventId = asText(payload.externalEventId || payload.eventId) || createEventId()
  return {
    externalUserId,
    ...(externalConversationId || requireConversation ? { externalConversationId } : {}),
    externalEventId,
  }
}

export function mapTransportRequestToChannel(
  type: string,
  value: unknown,
  createEventId: () => string = randomUUID,
): { method: ChannelHostMethod; input: Record<string, unknown> } {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as TransportPayload
    : {}

  switch (type) {
    case 'adapter.connection':
      return {
        method: 'connection.update',
        input: {
          connected: Boolean(payload.connected),
          ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
        },
      }
    case 'chat.message.received':
      return {
        method: 'message.receive',
        input: {
          ...externalIdentity(payload, createEventId, true),
          ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
          ...(Array.isArray(payload.attachments) ? { attachments: payload.attachments } : {}),
        },
      }
    case 'turn.delivery.ack':
      return {
        method: 'delivery.ack',
        input: {
          deliveryId: asText(payload.turnId),
          ok: payload.ok !== false,
          kind: 'turn',
          ...(asText(payload.chatId) ? { externalConversationId: asText(payload.chatId) } : {}),
          ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
        },
      }
    default:
      throw new Error(`Unsupported Moss Host bridge request: ${type}`)
  }
}

export function mapChannelEventToTransport(
  name: ChannelBackendEvent,
  value: unknown,
): TransportPayload {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as TransportPayload
    : {}
  const { externalConversationId, ...payload } = data
  return {
    ...payload,
    ...(typeof externalConversationId === 'string' ? { chatId: externalConversationId } : {}),
  }
}

/**
 * Feishu transport facade over the versioned Moss Host protocols.
 */
export class FeishuHostBridge {
  private client: AppBackendClient
  private handlers = new Map<string, Set<FeishuHostBridgeEventHandler>>()
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
  private createEventId: () => string

  constructor(options: FeishuHostBridgeOptions = {}) {
    this.createEventId = options.createEventId || randomUUID
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
    if (!this.available) throw new Error('Moss App Channel bridge is unavailable.')
    const context = await this.initializePromise
    if (context.appId !== 'moss.feishu') {
      throw new Error('Moss App Channel bridge identity mismatch.')
    }
    return context
  }

  request(type: string, payload: unknown = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<any> {
    if (!this.available) return Promise.reject(new Error('Moss App Channel bridge is unavailable.'))
    const mapped = mapTransportRequestToChannel(type, payload, this.createEventId)
    return this.client.requestChannelHost(mapped.method, mapped.input as any, { timeoutMs })
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

  on(type: string, handler: FeishuHostBridgeEventHandler): () => void {
    if (!(CHANNEL_BACKEND_EVENTS as readonly string[]).includes(type)) {
      throw new Error(`Unsupported Moss App Channel event: ${type}`)
    }
    const entries = this.handlers.get(type) ?? new Set<FeishuHostBridgeEventHandler>()
    entries.add(handler)
    this.handlers.set(type, entries)
    if (!this.eventSubscriptions.has(type)) {
      const unsubscribe = this.client.onChannelEvent(type as ChannelBackendEvent, async (data, context) => {
        const event: TransportEvent = {
          version: 1,
          id: context.eventId,
          type,
          timestamp: Date.now(),
          payload: data,
        }
        for (const entry of [...(this.handlers.get(type) || [])]) {
          await entry(mapChannelEventToTransport(type as ChannelBackendEvent, data), event)
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
    this.fail(new Error('Moss App Channel bridge closed before startup completed.'))
    for (const unsubscribe of this.eventSubscriptions.values()) unsubscribe()
    this.eventSubscriptions.clear()
    this.handlers.clear()
    ;(this.client as AppBackendClient & { closeChannel: () => void }).closeChannel()
  }
}
