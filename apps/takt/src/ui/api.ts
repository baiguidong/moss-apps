import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
declare global { interface Window { mossApp?: AppUiApi } }
export const client = window.mossApp ? createAppClient(window.mossApp) : null
export async function request(name: string, input: Record<string, unknown> = {}): Promise<any> {
  if (!client) throw new Error('请在 Moss 中打开 TAKT 工作流 App')
  return client.actions.invoke(name, input, { timeoutMs: 30000 })
}
