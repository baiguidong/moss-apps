import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { RequestInput, RequestResult, Template } from '../contracts'
declare global { interface Window { mossApp?: AppUiApi } }
export async function send(input: RequestInput, signal: AbortSignal): Promise<RequestResult> {
  if (!window.mossApp) throw new Error('请在 Moss 中打开 HTTP 调试后发送请求。')
  try {
    return await createAppClient(window.mossApp).actions.invoke<RequestResult>('request.send', input, { signal, timeoutMs: 135000 })
  } finally { window.dispatchEvent(new Event('http-operation')) }
}
export async function runtimeStatus(): Promise<string> {
  if (!window.mossApp) return '浏览器预览 · 在 Moss 中发送请求'
  const [installation, status] = await Promise.all([window.mossApp.app.getInstallationState(), window.mossApp.app.getStatus()])
  if (((installation?.installation || installation) as { enabled?: boolean } | null)?.enabled === false) return '应用已停用，请在 Moss 中启用'
  return ({ running: '本地服务运行中', starting: '本地服务启动中', stopped: '就绪 · 按需运行', error: '服务异常，请在 Moss 中重启', 'crash-loop': '服务反复退出，请在 Moss 中重启', failed: '服务启动失败' } as Record<string, string>)[String(status?.state || 'stopped')] || '本地服务正在准备'
}
export async function loadTemplates(): Promise<unknown> {
  return window.mossApp ? window.mossApp.storage.getItem('request-templates-v1') : []
}
export async function storeTemplates(templates: Template[]) {
  if (!window.mossApp) throw new Error('请在 Moss 中保存请求模板。')
  try { await window.mossApp.storage.setItem('request-templates-v1', templates) }
  catch (error) {
    if (/size limit|too large/i.test(error instanceof Error ? error.message : '')) throw new Error('模板内容超过本地存储上限，请减少模板或参数名称的长度。')
    throw new Error('模板保存失败，请在 Moss 中检查应用状态后重试。')
  }
}
