import type { AppUiApi } from '@moss/app-sdk'
import { timeout, type Catalog, type Input, type Method, type Result } from '../contracts'
import { demoRequest } from './demo'
declare global { interface Window { mossApp?: AppUiApi } }
let instancePromise: Promise<string> | undefined
const pending = new Map<string, string>()
async function instance() {
  if (!window.mossApp) throw new Error('请在 Moss 中打开 MCP。')
  return instancePromise ??= window.mossApp.instances.list().then(items => {
    if (!items[0]?.id) throw new Error('请先在应用管理中启用 MCP。')
    return String(items[0].id)
  }).catch(error => { instancePromise = undefined; throw error })
}
export async function request(method: Method, input: Input = {}, signal?: AbortSignal): Promise<Catalog> {
  if (!window.mossApp) return demoRequest(method, input)
  const api = window.mossApp, id = await instance(), requestId = crypto.randomUUID()
  signal?.throwIfAborted()
  pending.set(requestId, id)
  const cancel = () => { void api.actions.cancel(id, requestId).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await api.actions.invoke<Result>(id, method, input, { requestId, timeoutMs: timeout(method) })
    signal?.throwIfAborted()
    if (!response.ok) throw new Error(response.error.message)
    return response.data
  } finally { pending.delete(requestId); signal?.removeEventListener('abort', cancel) }
}
export function cancelRequests() { for (const [requestId, id] of pending) void window.mossApp?.actions.cancel(id, requestId).catch(() => {}) }
export async function runtimeStatus(): Promise<{ state: string; label: string }> {
  if (!window.mossApp) return { state: 'demo', label: '演示模式' }
  const installation = await window.mossApp.app.getInstallationState()
  if ((installation?.installation as { enabled?: boolean })?.enabled === false) return { state: 'disabled', label: '应用已停用' }
  const value = await window.mossApp.instances.getStatus(await instance())
  const state = String(value?.state || 'stopped')
  return { state, label: ({ running: '服务运行中', starting: '正在启动', stopped: '服务已停止', 'crash-loop': '服务反复退出', failed: '启动失败', error: '服务异常' } as Record<string, string>)[state] || '正在准备服务' }
}
