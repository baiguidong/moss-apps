import { readJsonResult } from '@moss/app-sdk/results'
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
  return readJsonResult<T>(result, {
    read: (input, options) => host.actions.invoke('result.read', input, options),
    release: id => host.actions.invoke('result.release', { id }),
  })
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
