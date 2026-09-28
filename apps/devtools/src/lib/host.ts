import type { AppUiApi } from '@moss/app-sdk'
import type { Action, Inputs, Outputs } from '../contracts'
import { execute } from '../core'
declare global { interface Window { mossApp?: AppUiApi } }
let instancePromise: Promise<string> | undefined
async function instance() {
  if (!instancePromise) instancePromise = window.mossApp!.instances.list().then(items => {
    const id = items[0]?.id
    if (!id) throw new Error('开发工具暂不可用，请在 Moss 应用管理中检查启用状态。')
    return String(id)
  }).catch(error => { instancePromise = undefined; throw error })
  return instancePromise
}
export async function invoke<K extends Action>(action: K, input: Inputs[K]): Promise<Outputs[K]> {
  if (!window.mossApp) {
    return execute(action, input)
  }
  return window.mossApp.actions.invoke<Outputs[K]>(await instance(), action, input, { timeoutMs: 15000 })
}
export async function runtimeStatus(): Promise<string> {
  if (!window.mossApp) return '浏览器本地运行'
  const api = window.mossApp
  const [installation, status] = await Promise.all([api.app.getInstallationState(), api.instances.getStatus(await instance())])
  const install = (installation?.installation || installation) as { enabled?: boolean } | null
  if (install?.enabled === false) return '应用已停用，请在 Moss 中启用'
  const state = String(status?.state || 'stopped')
  return ({ running: '本地服务运行中', starting: '本地服务启动中', stopped: '就绪 · 按需运行', error: '服务异常，请在 Moss 中重启', 'crash-loop': '服务反复退出，请在 Moss 中重启', failed: '服务启动失败' } as Record<string, string>)[state] || '本地服务正在准备'
}
