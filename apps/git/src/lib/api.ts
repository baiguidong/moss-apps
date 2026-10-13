import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import { timeout, type Catalog, type Input, type Method, type Result } from '../contracts'
import { demoRequest } from './demo'
declare global { interface Window { mossApp?: AppUiApi } }
let client: ReturnType<typeof createAppClient> | undefined
export async function request(method: Method, input: Input = {}, signal?: AbortSignal): Promise<Catalog> {
  if (!window.mossApp) return demoRequest(method, input)
  client ??= createAppClient(window.mossApp)
  const response = await client.actions.invoke<Result>(method, input, { signal, timeoutMs: timeout() })
  if (!response.ok) throw new Error(response.error.message)
  return response.data
}
export function cancelRequests() { client?.dispose(); client = undefined }
