import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import { timeout, type Catalog, type Input, type Method, type Result } from '../contracts'
import { demoRequest } from './demo'
declare global { interface Window { mossApp?: AppUiApi } }
let client: ReturnType<typeof createAppClient> | undefined
export async function request(method: Method, input: Input = {}, signal?: AbortSignal): Promise<Catalog> {
  if (!window.mossApp) return demoRequest(method, input)
  client ??= createAppClient(window.mossApp)
  const response = await client.actions.invoke<Result>(method, input, { signal, timeoutMs: timeout(method) })
  if (!response.ok) throw new Error(response.error.message)
  return response.data
}
export function cancelRequests() { client?.dispose(); client = undefined }
export async function runtimeStatus(): Promise<{ state: string; label: string }> {
  if (!window.mossApp) return { state: 'demo', label: '演示模式' }
  const installation = await window.mossApp.app.getInstallationState()
  if ((installation?.installation as { enabled?: boolean })?.enabled === false) return { state: 'disabled', label: '应用已停用' }
  const value = await window.mossApp.app.getStatus()
  const state = String(value?.state || 'stopped')
  return { state, label: ({ running: '服务运行中', starting: '正在启动', stopped: '服务已停止', 'crash-loop': '服务反复退出', failed: '启动失败', error: '服务异常' } as Record<string, string>)[state] || '正在准备服务' }
}
