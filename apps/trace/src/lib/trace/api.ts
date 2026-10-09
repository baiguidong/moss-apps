import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { MessageEntry } from '@/types/trace-session'
import type { TraceCallRecord, TraceSession, TraceSessionDeleteResult, TraceSessionList } from '@/types/trace'
declare global { interface Window { mossApp?: AppUiApi } }
export type TraceTarget = 'local'
export type TraceSessionSnapshot = TraceSession & { messages: MessageEntry[]; messageSignature?: string }
export type TraceSessionRevision = { sessionId: string; revision: number; revisionToken?: string; changed: boolean; reset: boolean }
async function invoke<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const bridge = window.mossApp
  if (!bridge) throw new Error('请在 Moss 中打开 Trace App。')
  const host = createAppClient(bridge)
  const result = await host.actions.invoke<{ value?: T; transfer?: { id: string; size: number } }>(name, input, { timeoutMs: 60_000 })
  if (!result.transfer) return result.value as T
  const { id, size } = result.transfer
  if (!Number.isInteger(size) || size <= 0 || size > 32 * 1024 * 1024) throw new Error('Trace 结果大小无效。')
  const bytes = new Uint8Array(size)
  let offset = 0
  try {
    while (offset < size) {
      const part = await host.actions.invoke<{ data: string; nextOffset: number; done: boolean }>('result.read', { id, offset })
      const raw = atob(part.data)
      if (part.nextOffset !== offset + raw.length || part.nextOffset > size || raw.length === 0) throw new Error('Trace 读取不完整，请重试。')
      for (let index = 0; index < raw.length; index++) bytes[offset + index] = raw.charCodeAt(index)
      offset = part.nextOffset
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } finally { void host.actions.invoke('result.release', { id }).catch(() => {}) }
}
export const tracesApi = {
  list(_target: TraceTarget, options: { limit?: number; offset?: number; query?: string } = {}) { return invoke<TraceSessionList>('traces.list', options) },
  get(_target: TraceTarget, sessionId: string) { return invoke<TraceSessionSnapshot>('traces.get', { sessionId }) },
  getCall(_target: TraceTarget, sessionId: string, callId: string) { return invoke<TraceCallRecord>('traces.call', { sessionId, callId }) },
  getRevision(_target: TraceTarget, sessionId: string, sinceRevision?: number, sinceRevisionToken?: string) {
    return invoke<TraceSessionRevision>('traces.revision', { sessionId, sinceRevision, sinceRevisionToken })
  },
  deleteSession(_target: TraceTarget, sessionId: string) { return invoke<TraceSessionDeleteResult>('traces.delete', { sessionId }) },
}
