import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { Catalog } from '../types'
declare global { interface Window { mossApp?: AppUiApi } }
let client: ReturnType<typeof createAppClient> | undefined
export async function request(method: string, input: unknown = {}, signal?: AbortSignal): Promise<Catalog> {
  if (!window.mossApp) throw new Error('请在 Moss 中打开数据库查询 App。')
  client ??= createAppClient(window.mossApp)
  const result = await client.actions.invoke<{ ok: boolean; data: Catalog; error?: string }>(`connections.${method}`, input, { signal, timeoutMs: method === 'inspect' ? 300000 : 65000 })
  if (!result.ok) throw new Error(result.error || '操作失败，请重试。')
  return result.data
}
export function dispose() { client?.dispose(); client = undefined }
