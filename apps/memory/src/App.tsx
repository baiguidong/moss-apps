import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2, FolderArchive, RefreshCw, Search, Settings2, Wrench } from 'lucide-react'
import { MEMORY, MEMORY_VERSION } from './contracts'
import type { Catalog, SaveInput } from './contracts'
import { request } from './lib/api'
import { MemoryEditor } from './components/memory-editor'
import { MemoryGraphView } from './components/memory-graph'
import './memory.css'

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
      if (mounted.current && current === revision.current) setError(cause instanceof Error ? cause.message : '读取记忆服务状态失败。')
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
    const offStatus = window.mossApp?.events.on('memory.changed', () => { void load() })
    const offRuntime = window.mossApp?.events.on('runtime', () => { void refreshRuntime(); void load() })
    return () => { mounted.current = false; ++revision.current; offStatus?.(); offRuntime?.() }
  }, [load])
  const connecting = Boolean(catalog && ['configuring', 'connecting'].includes(catalog.preparation.state))
  useEffect(() => {
    if (!connecting || busy || unavailable || error) return
    const timer = setTimeout(() => { void load() }, 750)
    return () => clearTimeout(timer)
  }, [catalog, connecting, busy, unavailable, error, load])
  const server = catalog?.servers.find(item => item.name === MEMORY)
  const failed = error || catalog?.preparation.error || (!connecting && server?.check?.state === 'failed' ? server.check.error : '')
  const checked = !connecting && !failed && server?.check?.state === 'connected'
  const label = unavailable ? 'App 未运行' : connecting ? (catalog?.preparation.state === 'configuring' ? '正在配置' : '正在连接') : failed ? '连接失败' : checked ? '检查通过' : '等待连接'
  const reconnect = async () => {
    ++revision.current; setBusy(true); setError('')
    try { const result = await request('servers.inspect', {}); if (mounted.current) setCatalog(result) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '重新连接失败。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const save = async (input: SaveInput) => {
    ++revision.current; setBusy(true)
    try { const result = await request('servers.save', input); if (mounted.current) { setCatalog(result); setError('') } }
    finally { if (mounted.current) { setBusy(false); void load() } }
  }
  const tools = (server?.check?.tools || []).filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))

  return <main className="app-shell" aria-label="记忆"><div className="memory-workspace">
    {!window.mossApp && <div className="demo-note">演示模式 · 仅展示界面，操作不会写入真实记忆</div>}
    <MemoryGraphView available={!unavailable} />
    <section className="memory-card connection-card" aria-label="记忆服务状态" aria-busy={connecting}>
      <div className="connection-top"><span className={`memory-status ${failed || unavailable ? 'failure' : checked ? 'ready' : ''}`} role="status">{connecting || (!catalog && !error) ? <Loader2 size={16} className="spin" /> : failed || unavailable ? <CircleAlert size={16} /> : <Check size={16} />}{!catalog && !error ? '正在读取状态' : label}</span><div className="connection-actions"><button className="button" onClick={() => setEditor(true)} disabled={!catalog || busy || unavailable}><Settings2 size={15} />记忆设置</button><button className="button primary" onClick={() => void reconnect()} disabled={busy || connecting || unavailable}><RefreshCw size={15} className={busy ? 'spin' : ''} />重新连接</button></div></div>
      {unavailable && <p className="memory-error" role="alert">请在 Moss 应用管理中启用记忆并检查权限。</p>}
      {failed && <p className="memory-error" role="alert">{failed}</p>}
      <div className="memory-target"><FolderArchive size={18} /><div><strong>本地记忆文件</strong><span>{catalog?.memoryFile || '正在读取存储位置'}</span></div>{checked && server?.check && <small>最近检查 {date(server.check.checkedAt)}</small>}</div>
      <p className="memory-note">记忆保存在此设备。关闭页面、重启或更新 App 后仍会保留。</p>
    </section>
    <div className="memory-guides"><section className="memory-card"><span className="section-kicker">开始使用</span><h3>在对话中试试这些任务</h3><ul className="example-list"><li>记住：我偏好简洁的中文回答</li><li>记录新项目的负责人、目标和关联信息</li><li>查找之前保存的项目进度，补充最新情况</li></ul></section><section className="memory-card"><span className="section-kicker">保存与管理</span><h3>你决定保留哪些记忆</h3><p>让 Moss 记录需要长期使用的信息，也可以在对话中要求更正或删除。启用此 App 的对话共用本机这份记忆。</p><p className="memory-note">工具设置可排除不需要的操作；停用 App 会停止向对话提供记忆工具。</p></section></div>
    <details className="memory-card memory-tools"><summary><Wrench size={16} /><span>工具详情</span><small>{server?.check?.tools.length || 0} 项</small><ChevronDown size={15} /></summary><div className="memory-tools-body"><div className="search-field"><Search size={15} /><input aria-label="搜索工具" placeholder="查找工具" value={query} onChange={event => setQuery(event.target.value)} /></div>{tools.map(tool => <article className="tool-row" key={tool.name}><Wrench size={15} /><div><h4>{tool.name}{tool.disabled && <span className="muted-badge">已排除</span>}</h4><p>{tool.description || '此工具未提供描述。'}</p></div></article>)}{!tools.length && <p className="memory-note">{query ? '没有匹配的工具。' : connecting ? '正在读取工具目录…' : '连接检查完成后展示可用工具。'}</p>}<p className="memory-note">Memory MCP {MEMORY_VERSION} · 随应用提供{server?.check?.truncated ? ' · 当前展示部分工具' : ''}。</p></div></details>
    <footer className="memory-footer">在应用管理中启用或停用记忆</footer>
  </div>{editor && catalog && <MemoryEditor server={server} memoryFile={catalog.memoryFile} onClose={() => setEditor(false)} onSave={save} />}</main>
}
