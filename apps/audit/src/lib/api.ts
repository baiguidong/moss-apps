import { readJsonResult } from '@moss/app-sdk/results'
import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { AuditDashboardPayload, AuditEventDetail, AuditRuleRecord, AuditFindingStatus, AuditSeverity } from '../types'
declare global { interface Window { mossApp?: AppUiApi } }
async function invoke<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const bridge = window.mossApp
  if (!bridge) throw new Error('请在 Moss 中打开审计 App。')
  const host = createAppClient(bridge)
  const result = await host.actions.invoke<{ value?: T; transfer?: { id: string; size: number } }>(name, input, { timeoutMs: 120_000 })
  return readJsonResult<T>(result, {
    read: (input, options) => host.actions.invoke('result.read', input, options),
    release: id => host.actions.invoke('result.release', { id }),
  })
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
