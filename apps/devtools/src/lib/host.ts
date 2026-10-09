import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import type { Action, Inputs, Outputs } from '../contracts'
import { execute } from '../core'
declare global { interface Window { mossApp?: AppUiApi } }
export async function invoke<K extends Action>(action: K, input: Inputs[K]): Promise<Outputs[K]> {
  if (!window.mossApp) {
    return execute(action, input)
  }
  return createAppClient(window.mossApp).actions.invoke<Outputs[K]>(action, input, { timeoutMs: 15000 })
}
export async function runtimeStatus(): Promise<string> {
  if (!window.mossApp) return '浏览器本地运行'
  const api = window.mossApp
  const [installation, status] = await Promise.all([api.app.getInstallationState(), api.app.getStatus()])
  const install = (installation?.installation || installation) as { enabled?: boolean } | null
  if (install?.enabled === false) return '应用已停用，请在 Moss 中启用'
  const state = String(status?.state || 'stopped')
  return ({ running: '本地服务运行中', starting: '本地服务启动中', stopped: '就绪 · 按需运行', error: '服务异常，请在 Moss 中重启', 'crash-loop': '服务反复退出，请在 Moss 中重启', failed: '服务启动失败' } as Record<string, string>)[state] || '本地服务正在准备'
}
