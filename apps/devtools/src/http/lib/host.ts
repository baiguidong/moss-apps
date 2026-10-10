import { createAppClient } from '@moss/app-sdk/ui'
import type { RequestInput, RequestResult, Template } from '../contracts'
export async function send(input: RequestInput, signal: AbortSignal): Promise<RequestResult> {
  if (!window.mossApp) throw new Error('请在 Moss 中打开开发工具的 HTTP 调试后发送请求。')
  try {
    return await createAppClient(window.mossApp).actions.invoke<RequestResult>('request.send', input, { signal, timeoutMs: 135000 })
  } finally { window.dispatchEvent(new Event('devtools-operation')) }
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
