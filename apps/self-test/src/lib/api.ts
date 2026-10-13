import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { SelfTestCase, SelfTestInstanceStatus, SelfTestStatus } from '../types'
declare global { interface Window { mossApp?: AppUiApi } }
let client: ReturnType<typeof createAppClient> | undefined
function getClient() {
  if (!window.mossApp) throw new Error('请在 Moss 的 AI 自测 App 中打开此页面。')
  return client ??= createAppClient(window.mossApp)
}
const invoke = <T,>(name: string, input: object = {}) => getClient().actions.invoke<T>(name, input)
export const api = {
  catalog: () => invoke<{ cases: SelfTestCase[] }>('catalog'),
  status: (runId?: string) => invoke<SelfTestStatus>('status', { runId }),
  start: (caseIds: string[]) => invoke<SelfTestStatus>('run.start', { caseIds }),
  stop: (runId?: string) => invoke<SelfTestStatus>('run.stop', { runId }),
  openSession: (runId?: string) => invoke('session.open', { runId }),
  openReport: (runId?: string) => invoke('report.open', { runId }),
  revealReport: (runId?: string) => invoke('report.reveal', { runId }),
  instanceStatus: () => invoke<SelfTestInstanceStatus>('instance.status'),
  openInstance: () => invoke<SelfTestInstanceStatus>('instance.open'),
  closeInstance: () => invoke<SelfTestInstanceStatus>('instance.close'),
  syncInstance: () => invoke<SelfTestInstanceStatus>('instance.sync'),
  clearData: () => invoke<SelfTestInstanceStatus>('instance.reset'),
  onChanged: (listener: (state: SelfTestStatus) => void) => getClient().events.on('self-test.changed', value => listener(value as SelfTestStatus)),
  onInstanceChanged: (listener: (state: SelfTestInstanceStatus) => void) => getClient().events.on('instance.changed', value => listener(value as SelfTestInstanceStatus)),
}
export function disposeClient() { client?.dispose(); client = undefined }
