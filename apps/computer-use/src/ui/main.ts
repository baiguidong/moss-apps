import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import { syncAppearance } from './appearance'
import './theme.css'
import './style.css'
declare global { interface Window { mossApp?: AppUiApi } }
const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
<div id="error" role="alert" hidden></div><section class="hero"><div><h2 id="phase" role="status">正在连接 Moss…</h2><p id="detail">在对话中选择此 App，即可使用电脑操控工具。</p></div><button id="enable" class="primary" disabled>开启控制</button></section>
<div class="grid"><section><h2>系统权限</h2><p id="permission-help">正在检查系统能力。</p><div class="permission"><span id="accessibility-label">辅助功能</span><b id="accessibility">—</b></div><div class="permission"><span id="screen-label">屏幕录制</span><b id="screen">—</b></div><div class="actions"><button data-operation="request-permissions">发起系统授权</button><button data-operation="check">重新检查</button></div><div class="links" id="mac-settings"><button data-permission="accessibility">打开辅助功能设置</button><button data-permission="screen">打开屏幕录制设置</button><button data-operation="reveal-host-app">在访达中显示 Moss</button></div><p id="notice" role="status"></p></section>
<section><h2>已允许的应用</h2><p>每个目标应用由 Moss 单独询问授权。</p><div id="grants"></div></section></div>
<section id="active" hidden><h2>正在控制</h2><p id="owner"></p><button class="destructive" data-operation="stop">停止控制</button></section>
<footer><span>支持 Windows 10/11 x64 和 macOS 14+（Apple Silicon / Intel）。应用界面和截图可能发送给当前模型服务。</span><span id="version"></span></footer>`
const stopAppearance = syncAppearance()
let enabled = false, supported = false, busy = false, disposed = false, connected = false
type Operation = 'status' | 'enable' | 'check' | 'request-permissions' | 'open-settings' | 'reveal-host-app' | 'stop' | 'revoke'
const client = window.mossApp ? createAppClient(window.mossApp) : null
const node = (id: string) => document.getElementById(id)!
const labels: Record<string,string> = { disabled:'控制已关闭', 'not-checked':'等待权限检查', starting:'正在启动', 'needs-permission':'等待系统授权', ready:'已就绪', stopping:'正在停止', error:'需要处理' }
function render(status: any) {
  const windows = status.platform === 'win32'
  node('permission-help').textContent = windows ? 'Windows 使用 UI Automation 和屏幕捕获。普通权限即可控制同等权限的应用；不支持 UAC 安全桌面。' : 'macOS 的授权对象是 Moss。'
  node('accessibility-label').textContent = windows ? 'UI Automation' : '辅助功能'
  node('screen-label').textContent = windows ? '屏幕捕获' : '屏幕录制'
  node('mac-settings').hidden = windows
  document.querySelector<HTMLButtonElement>('[data-operation="request-permissions"]')!.hidden = windows
  connected = true
  enabled = status.enabled
  supported = status.supported === true
  node('phase').textContent = labels[status.phase] || status.phase
  node('phase').dataset.state = status.phase
  node('detail').textContent = status.supported ? '在对话中选择此 App，即可读取界面、截图、点击和输入。' : '当前设备不支持电脑操控。'
  const toggle = node('enable') as HTMLButtonElement
  toggle.textContent = enabled ? '关闭控制' : '开启控制'; toggle.disabled = busy || !status.supported
  node('accessibility').textContent = status.permissions?.accessibility ? (windows ? '可用' : '已允许') : (windows ? '未就绪' : '待授权')
  node('screen').textContent = status.permissions?.screenRecording ? (windows ? '可用' : '已允许') : (windows ? '未就绪' : '待授权')
  node('accessibility').dataset.allowed = String(Boolean(status.permissions?.accessibility))
  node('screen').dataset.allowed = String(Boolean(status.permissions?.screenRecording))
  node('notice').textContent = status.permissionNotice || status.error || ''
  node('version').textContent = `Cua ${status.version || '—'}`
  node('active').hidden = !status.active
  node('owner').textContent = status.active ? `${status.active.app?.name || '正在选择应用'} · ${status.active.title}` : ''
  const list = node('grants'); list.replaceChildren()
  const grants = [...(status.apps || []), ...(status.sessionApps || []).filter((s: any) => !status.apps?.some((a: any) => a.bundleId === s.bundleId))]
  if (!grants.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '尚未授权应用。首次操作时，Moss 会显示授权卡片。'; list.append(empty) }
  for (const grant of grants) {
    const row = document.createElement('div'); row.className = 'permission'
    const text = document.createElement('span'); text.textContent = `${grant.name || grant.bundleId}${grant.sessionId ? ' · 本次会话' : ''}`
    const button = document.createElement('button'); button.textContent = '撤销'; button.disabled = busy
    button.onclick = () => void perform('revoke', { bundleId: grant.bundleId })
    row.append(text, button); list.append(row)
  }
}
async function request(operation: Operation, input = {}) {
  if (!client) throw new Error('请从 Moss 中打开此 App。')
  const result = await client.host.request('moss.host/v1', 'native.settings', { operation, ...input }, { timeoutMs: 60000 })
  if (!disposed) render(result)
}
async function perform(operation: Operation, input = {}) {
  if (busy) return
  busy = true; void window.mossApp?.view?.setState({ dirty: false, busy: true }).catch(() => {}); node('error').hidden = true
  document.querySelectorAll('button').forEach(b => { b.disabled = true })
  try { await request(operation, input) }
  catch (error) {
    if (disposed) return
    const message = error instanceof Error ? error.message : String(error)
    const trustError = message.includes('Native adapters require a trusted signature')
    node('error').textContent = trustError ? '此安装包未通过 Moss 的原生发布者签名校验。请安装由 Moss 认可的发布者签名的版本，再重新打开应用。' : message
    node('error').hidden = false
    if (!connected) {
      node('phase').textContent = trustError ? '需要受信任的安装包' : '暂时无法连接'
      node('phase').dataset.state = 'error'
      node('detail').textContent = trustError ? '原生驱动尚未加载。' : '请重新检查或重新打开应用。'
    }
  }
  finally {
    busy = false
    void window.mossApp?.view?.setState({ dirty: false, busy: false }).catch(() => {})
    if (!disposed) {
      document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = !connected && b.dataset.operation !== 'check' })
      ;(node('enable') as HTMLButtonElement).disabled = !supported
    }
  }
}
node('enable').onclick = () => void perform('enable', { enabled: !enabled })
document.querySelectorAll<HTMLButtonElement>('[data-operation]').forEach(b => { b.onclick = () => void perform(b.dataset.operation as Operation) })
document.querySelectorAll<HTMLButtonElement>('[data-permission]').forEach(b => { b.onclick = () => void perform('open-settings', { permission: b.dataset.permission }) })
// Opening settings reads state. Permission probing remains an explicit action.
void perform('status')
const timer = setInterval(() => { if (!busy && !document.hidden) void request('status').catch(() => {}) }, 2500)
const cleanup = () => { disposed = true; clearInterval(timer); stopAppearance(); client?.dispose() }
window.addEventListener('pagehide', cleanup, { once: true })
if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('pagehide', cleanup); cleanup() })
