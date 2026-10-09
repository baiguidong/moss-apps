import type { AppUiApi } from '@moss/app-sdk'
import type { AuditDashboardPayload, AuditEventDetail, AuditRuleRecord, AuditFindingStatus, AuditSeverity } from '../types'
declare global { interface Window { mossApp?: AppUiApi } }
let instancePromise: Promise<string> | undefined
async function invoke<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const host = window.mossApp
  if (!host) throw new Error('请在 Moss 中打开审计 App。')
  const instanceId = await (instancePromise ??= host.instances.list().then(items => {
    if (!items[0]?.id) throw new Error('请在应用管理中启用 审计中心。')
    return String(items[0].id)
  }).catch(error => { instancePromise = undefined; throw error }))
  const result = await host.actions.invoke<{ value?: T; transfer?: { id: string; size: number } }>(instanceId, name, input, { timeoutMs: 120_000 })
  if (!result.transfer) return result.value as T
  const { id, size } = result.transfer
  if (!Number.isInteger(size) || size <= 0 || size > 32 * 1024 * 1024) throw new Error('审计结果大小无效。')
  const bytes = new Uint8Array(size)
  let offset = 0
  try {
    while (offset < size) {
      const part = await host.actions.invoke<{ data: string; nextOffset: number; done: boolean }>(instanceId, 'result.read', { id, offset })
      const raw = atob(part.data)
      if (part.nextOffset !== offset + raw.length || part.nextOffset > size || raw.length === 0) throw new Error('审计读取不完整，请重试。')
      for (let index = 0; index < raw.length; index++) bytes[offset + index] = raw.charCodeAt(index)
      offset = part.nextOffset
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } finally { void host.actions.invoke(instanceId, 'result.release', { id }).catch(() => {}) }
}

export type AuditChange = { reason: string; scope?: { kind?: string; sessionIds?: string[] }; completed?: number; total?: number }
export const auditApi = {
  getDashboard: () => invoke<AuditDashboardPayload>('dashboard.get', {}),
  getEvent: (input: { id: string }) => invoke<AuditEventDetail>('event.get', input),
  run: (input: { sessionIds?: string[] } = {}) => invoke<{ ok: boolean; runId: string; sessionCount: number; toolCallCount: number; findingCount: number }>('audit.run', input),
  updateRule: (input: { id: string; enabled?: boolean; severity?: AuditSeverity; config?: AuditRuleRecord['config'] }) => invoke<AuditRuleRecord>('rule.update', input),
  updateFinding: (input: { id: string; status: AuditFindingStatus }) => invoke<{ ok: boolean }>('finding.update', input),
  updateFindings: (input: { ids: string[]; status: AuditFindingStatus }) => invoke<{ ok: boolean; updatedCount: number }>('findings.update', input),
  openSession: (sessionId: string, toolUseId?: string) => invoke<{ opened: boolean }>('session.open', { sessionId, ...(toolUseId ? { toolUseId } : {}) }),
  onChanged: (callback: (event: AuditChange) => void) => window.mossApp?.events.on('audit.changed', event => callback(event as AuditChange)) || (() => {}),
}
