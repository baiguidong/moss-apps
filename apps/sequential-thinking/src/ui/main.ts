import { createAppClient } from '@moss/app-sdk/ui'
import type { AppAppearance, AppUiApi } from '@moss/app-sdk'
import { THINKING, type Catalog, type Method, type Result } from '../contracts'

declare global { interface Window { mossApp?: AppUiApi } }
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const refresh = element<HTMLButtonElement>('refresh'), reconnect = element<HTMLButtonElement>('reconnect')
const status = element('status'), detail = element('status-detail'), error = element('error')
const client = window.mossApp ? createAppClient(window.mossApp) : undefined
let disposed = false, pending = false, refreshAgain = false, connecting = false
let timer: ReturnType<typeof setTimeout> | undefined

function render(catalog: Catalog) {
  const server = catalog.servers.find(item => item.name === THINKING)
  const state = catalog.preparation.state
  connecting = state === 'configuring' || state === 'connecting'
  status.dataset.state = state
  status.textContent = { configuring: '准备中', connecting: '连接中', ready: '已连接', failed: '连接失败' }[state]
  detail.textContent = {
    configuring: '正在准备分步思考服务…', connecting: '正在连接服务并读取工具目录…',
    ready: '服务已就绪，可在会话中按需使用。', failed: '服务暂时不可用，可重新连接。',
  }[state]
  error.textContent = state === 'failed' ? catalog.preparation.error || server?.check?.error || '连接失败，请重试。' : ''
  error.hidden = !error.textContent
  element('checked-at').textContent = server?.check?.checkedAt
    ? `最近检查：${new Date(server.check.checkedAt).toLocaleString('zh-CN')}` : '尚未完成检查'
  const tools = state === 'ready' ? server?.check?.tools || [] : []
  const available = tools.filter(tool => !tool.disabled)
  element('tool-count').textContent = state === 'ready' ? `${available.length} 个可用工具` : '连接完成后显示工具目录。'
  const rows = tools.map(tool => {
    const row = document.createElement('article'), content = document.createElement('div')
    const title = document.createElement('h3'), description = document.createElement('p')
    row.className = 'settings-row'
    title.textContent = tool.name
    description.textContent = tool.name === 'sequentialthinking'
      ? '记录思考步骤，修正已有步骤，并探索不同方案分支。' : tool.description || '此工具未提供描述。'
    content.append(title, description); row.append(content)
    if (tool.disabled) {
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = '已排除'; row.append(badge)
    }
    return row
  })
  if (!rows.length) {
    const empty = document.createElement('p'); empty.className = 'empty'
    empty.textContent = connecting ? '正在读取工具目录…' : state === 'failed' ? '重新连接后查看可用工具。' : '暂未发现可用工具。'
    element('tools').replaceChildren(empty)
  } else element('tools').replaceChildren(...rows)
}

async function load(method: Method = 'servers.list') {
  if (disposed) return
  if (pending) { if (method === 'servers.list') refreshAgain = true; return }
  clearTimeout(timer)
  pending = true; refresh.disabled = true; reconnect.disabled = true
  try {
    if (!client) throw new Error('请在 Moss 的“设置 → Apps”中打开分步思考。')
    const result = await client.actions.invoke<Result>(method, {}, { timeoutMs: 65_000 })
    if (!result.ok) throw new Error(result.error.message)
    if (!disposed) render(result.data)
  } catch (cause) {
    if (disposed) return
    connecting = false
    status.dataset.state = 'failed'; status.textContent = '读取失败'
    detail.textContent = '暂时无法读取服务状态，请重试。'
    element('tool-count').textContent = '暂时无法读取工具目录。'
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '刷新状态后查看可用工具。'
    element('tools').replaceChildren(empty)
    error.textContent = cause instanceof Error ? cause.message : '操作失败，请重试。'; error.hidden = false
  } finally {
    pending = false
    if (!disposed) {
      refresh.disabled = false; reconnect.disabled = connecting
      // Events can arrive while the catalog request is in flight. Read once more
      // instead of losing the final state; polling also recovers a missed event.
      timer = setTimeout(() => { refreshAgain = false; void load() }, refreshAgain ? 0 : connecting ? 1_000 : 15_000)
    }
  }
}
refresh.addEventListener('click', () => { void load() })
reconnect.addEventListener('click', () => { void load('servers.inspect') })
const offStatus = client?.events.on('thinking.changed', () => { void load() })

const media = matchMedia('(prefers-color-scheme: dark)')
let theme: AppAppearance['themeMode'] = 'system', appearanceVersion = 0
function applyTheme() {
  if (!disposed) document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
}
async function refreshAppearance() {
  const version = ++appearanceVersion
  try {
    const info = await client?.app.getInfo()
    if (disposed || version !== appearanceVersion) return
    theme = info?.appearance?.themeMode || 'system'
    applyTheme()
  } catch { /* Retain the last theme when the Host is temporarily unavailable. */ }
}
function onFocus() { void load(); void refreshAppearance() }
const offAppearance = client?.events.on('appearance', () => { void refreshAppearance() })
media.addEventListener('change', applyTheme)
window.addEventListener('focus', onFocus)
window.addEventListener('pagehide', () => {
  disposed = true; clearTimeout(timer); offStatus?.(); offAppearance?.(); client?.dispose()
  media.removeEventListener('change', applyTheme); window.removeEventListener('focus', onFocus)
}, { once: true })
applyTheme(); void refreshAppearance(); void load()
