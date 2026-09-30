import type { AppUiApi } from '@moss/app-sdk'
import type { MessageEntry } from '@/types/trace-session'
import type { TraceCallRecord, TraceSession, TraceSessionDeleteResult, TraceSessionList } from '@/types/trace'
declare global { interface Window { mossApp?: AppUiApi } }
export type TraceTarget = 'local'
export type TraceSessionSnapshot = TraceSession & { messages: MessageEntry[]; messageSignature?: string }
export type TraceSessionRevision = { sessionId: string; revision: number; revisionToken?: string; changed: boolean; reset: boolean }
let instancePromise: Promise<string> | undefined
async function invoke<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const host = window.mossApp
  if (!host) throw new Error('请在 Moss 中打开 Trace App。')
  const instanceId = await (instancePromise ??= host.instances.list().then(items => {
    if (!items[0]?.id) throw new Error('请在应用管理中启用 Trace。')
    return String(items[0].id)
  }).catch(error => { instancePromise = undefined; throw error }))
  const result = await host.actions.invoke<{ value?: T; transfer?: { id: string; size: number } }>(instanceId, name, input, { timeoutMs: 60_000 })
  if (!result.transfer) return result.value as T
  const { id, size } = result.transfer
  if (!Number.isInteger(size) || size <= 0 || size > 32 * 1024 * 1024) throw new Error('Trace 结果大小无效。')
  const bytes = new Uint8Array(size)
  let offset = 0
  try {
    while (offset < size) {
      const part = await host.actions.invoke<{ data: string; nextOffset: number; done: boolean }>(instanceId, 'result.read', { id, offset })
      const raw = atob(part.data)
      if (part.nextOffset !== offset + raw.length || part.nextOffset > size || raw.length === 0) throw new Error('Trace 读取不完整，请重试。')
      for (let index = 0; index < raw.length; index++) bytes[offset + index] = raw.charCodeAt(index)
      offset = part.nextOffset
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } finally { void host.actions.invoke(instanceId, 'result.release', { id }).catch(() => {}) }
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
