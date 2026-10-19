import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2, Monitor, RefreshCw, Search, Settings2, Wrench } from 'lucide-react'
import { EXTENSION_URL, PLAYWRIGHT_CDP, PLAYWRIGHT_VERSION, browserFields, connectionTarget } from './browser-config'
import type { Catalog, SaveInput } from './contracts'
import { request } from './lib/api'
import { BrowserEditor } from './components/browser-editor'
import './browser.css'

const date = (value: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [editor, setEditor] = useState(false)
  const [query, setQuery] = useState(''), [unavailable, setUnavailable] = useState(false)
  const mounted = useRef(true), revision = useRef(0)
  const load = useCallback(async () => {
    const current = ++revision.current
    try {
      const result = await request('servers.list')
      if (mounted.current && current === revision.current) { setCatalog(result); setError('') }
    } catch (cause) {
      if (mounted.current && current === revision.current) setError(cause instanceof Error ? cause.message : '读取浏览器状态失败。')
    }
  }, [])
  useEffect(() => {
    mounted.current = true; void load()
    const refreshRuntime = async () => {
      if (!window.mossApp) return
      try {
        const [status, installation] = await Promise.all([window.mossApp.app.getStatus(), window.mossApp.app.getInstallationState()])
        if (mounted.current) setUnavailable((installation?.installation as { enabled?: boolean })?.enabled === false || !['running', 'starting'].includes(String(status?.state)))
      } catch { if (mounted.current) setUnavailable(true) }
    }
    void refreshRuntime()
    const offStatus = window.mossApp?.events.on('browser.changed', () => { void load() })
    const offRuntime = window.mossApp?.events.on('runtime', () => { void refreshRuntime(); void load() })
    return () => { mounted.current = false; ++revision.current; offStatus?.(); offRuntime?.() }
  }, [load])
  const connecting = Boolean(catalog && ['configuring', 'preparing', 'connecting'].includes(catalog.preparation.state))
  useEffect(() => {
    if (!connecting || busy || unavailable || error) return
    const timer = setTimeout(() => { void load() }, 750)
    return () => clearTimeout(timer)
  }, [catalog, connecting, busy, unavailable, error, load])
  const server = catalog?.servers.find(item => item.name === PLAYWRIGHT_CDP)
  const failed = error || catalog?.preparation.error || (server?.check?.state === 'failed' ? server.check.error : '')
  const checked = !connecting && !failed && server?.check?.state === 'connected'
  const label = unavailable ? 'App 未运行' : connecting ? (catalog?.preparation.state === 'configuring' ? '正在配置' : catalog?.preparation.state === 'preparing' ? '正在准备专用浏览器' : '正在连接') : failed ? '连接失败' : checked ? '工具已就绪' : '等待连接'
  const reconnect = async () => {
    ++revision.current; setBusy(true); setError('')
    try { const result = await request('servers.inspect', { name: PLAYWRIGHT_CDP }); if (mounted.current) setCatalog(result) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '重新连接失败。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const save = async (input: SaveInput) => {
    ++revision.current; setBusy(true)
    try { const result = await request('servers.save', input); if (mounted.current) { setCatalog(result); setError('') } }
    finally { if (mounted.current) { setBusy(false); void load() } }
  }
  const tools = (server?.check?.tools || []).filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))
  const fields = server && browserFields(server.config)
  return <main className="app-shell" aria-label="网页操控"><div className="browser-workspace">
    {!window.mossApp && <div className="demo-note">演示模式 · 仅展示界面，操作不会连接真实浏览器</div>}
    <section className="browser-card connection-card" aria-label="浏览器状态" aria-busy={connecting}>
      <div className="connection-top"><span className={`browser-status ${failed || unavailable ? 'failure' : checked ? 'ready' : ''}`} role="status">{connecting || (!catalog && !error) ? <Loader2 size={16} className="spin" /> : failed || unavailable ? <CircleAlert size={16} /> : <Check size={16} />}{!catalog && !error ? '正在读取状态' : label}</span><div className="connection-actions"><button className="button" onClick={() => setEditor(true)} disabled={!server || busy || unavailable}><Settings2 size={15} />连接设置</button><button className="button primary" onClick={() => void reconnect()} disabled={busy || connecting || unavailable}><RefreshCw size={15} className={busy ? 'spin' : ''} />重新连接</button></div></div>
      {unavailable && <p className="browser-error" role="alert">请在 Moss 应用管理中启用网页操控并检查权限。</p>}
      {failed && <p className="browser-error" role="alert">{failed}</p>}
      <div className="browser-target"><Monitor size={18} /><div><strong>Chrome 浏览器</strong><span>{server ? connectionTarget(server.config) : '正在读取连接配置'}</span></div>{checked && server?.check && <small>最近检查 {date(server.check.checkedAt)}</small>}</div>
      <p className="browser-note">{fields?.mode === 'managed' ? '实际操作网页时才打开专用浏览器；启动 Moss、查看设置和重新连接都不会打开窗口。浏览器与日常 Chrome 分开运行，保留登录状态并复用同一个实例。' : fields?.mode === 'cdp' ? '连接指定的已有浏览器服务；连接失败时不会另开浏览器。' : '通过扩展连接你日常使用的 Chrome，沿用已有登录状态和用户配置。实际操作网页时再建立连接。'}</p>
    </section>
    <div className="browser-guides"><section className="browser-card"><span className="section-kicker">开始使用</span><h3>在对话中试试这些任务</h3><ul className="example-list"><li>打开网站，帮我查找需要的信息</li><li>读取当前页面，整理成摘要</li><li>填写表单，并截取页面供我检查</li></ul></section><section className="browser-card"><span className="section-kicker">登录与连接</span><h3>{fields?.mode === 'managed' ? '登录一次，下次继续使用' : '继续使用已登录的 Chrome'}</h3>{fields?.mode === 'managed' ? <><p>在专用浏览器中登录需要使用的网站，之后会继续使用同一份配置，无需安装扩展。网站自身要求重新登录时按页面提示操作。</p><p className="browser-note">可以在连接设置中切换到日常 Chrome。切换模式和停用 App 都不会关闭日常浏览器。</p></> : fields?.mode === 'cdp' ? <p>使用已连接浏览器的现有登录状态。停用网页操控只断开连接，保留浏览器。</p> : <><p>首次使用请在日常 Chrome 中<a href={EXTENSION_URL} target="_blank" rel="noreferrer">安装 Playwright 扩展</a>。Moss 操作网页时，在扩展中允许连接并选择标签页。</p><p className="browser-note">书签、扩展和登录状态继续保留在原来的 Chrome 中。停用网页操控只断开连接。</p></>}</section></div>
    <details className="browser-card browser-tools"><summary><Wrench size={16} /><span>工具详情</span><small>{server?.check?.tools.length || 0} 项</small><ChevronDown size={15} /></summary><div className="browser-tools-body"><div className="search-field"><Search size={15} /><input aria-label="搜索工具" placeholder="查找工具" value={query} onChange={event => setQuery(event.target.value)} /></div>{tools.map(tool => <article className="tool-row" key={tool.name}><Wrench size={15} /><div><h4>{tool.name}{tool.disabled && <span className="muted-badge">已排除</span>}</h4><p>{tool.description || '此工具未提供描述。'}</p></div></article>)}{!tools.length && <p className="browser-note">{query ? '没有匹配的工具。' : connecting ? '正在读取工具目录…' : '连接检查完成后展示可用工具。'}</p>}<p className="browser-note">Playwright MCP {PLAYWRIGHT_VERSION} · 随应用提供{server?.check?.truncated ? ' · 当前展示部分工具' : ''}。工具已就绪表示服务可用，实际浏览器连接在操作网页时建立。</p></div></details>
    <footer className="browser-footer">在应用管理中启用或停用网页操控</footer>
  </div>{editor && server && <BrowserEditor server={server} onClose={() => setEditor(false)} onSave={save} />}</main>
}
