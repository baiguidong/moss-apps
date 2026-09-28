import type { AppUiApi } from '@moss/app-sdk'
import type { RequestInput, RequestResult, Template } from '../contracts'
declare global { interface Window { mossApp?: AppUiApi } }
let instancePromise: Promise<string> | undefined
async function instance(): Promise<string> {
  if (!window.mossApp) throw new Error('请在 Moss 中打开 HTTP 调试后发送请求。')
  if (!instancePromise) instancePromise = window.mossApp.instances.list().then(items => {
    if (!items[0]?.id) throw new Error('HTTP 调试暂不可用，请在 Moss 应用管理中检查启用状态。')
    return String(items[0].id)
  }).catch(error => { instancePromise = undefined; throw error })
  return instancePromise
}
export async function send(input: RequestInput, signal: AbortSignal): Promise<RequestResult> {
  const id = await instance(), api = window.mossApp!, requestId = crypto.randomUUID()
  if (signal.aborted) throw new Error('请求已取消。')
  let cancelTimer: ReturnType<typeof setInterval> | undefined
  const cancel = () => {
    // The Backend may still be starting. Retry until the pending action exists;
    // keep the UI in “canceling” until the original invocation settles.
    const attempt = () => { void api.actions.cancel(id, requestId).catch(() => {}) }
    attempt(); cancelTimer = setInterval(attempt, 250)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const result = await api.actions.invoke<RequestResult>(id, 'request.send', input, { requestId, timeoutMs: 135000 })
    if (signal.aborted) throw new Error('请求已取消。')
    return result
  } catch (error) {
    if (signal.aborted) throw new Error('请求已取消。')
    throw error
  } finally { signal.removeEventListener('abort', cancel); clearInterval(cancelTimer); window.dispatchEvent(new Event('http-operation')) }
}
export async function runtimeStatus(): Promise<string> {
  if (!window.mossApp) return '浏览器预览 · 在 Moss 中发送请求'
  const [installation, status] = await Promise.all([window.mossApp.app.getInstallationState(), window.mossApp.instances.getStatus(await instance())])
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
