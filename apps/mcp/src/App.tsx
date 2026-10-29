import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, KeyRound, Loader2, Pencil, Plus, RefreshCw, Search, Terminal, Trash2 } from 'lucide-react'
import { endpoint, status, type Catalog, type Input, type McpServer, type Method, type SaveInput } from './contracts'
import { request } from './lib/api'
import { ServerEditor } from './components/server-editor'
import { Dialog } from './components/dialog'

/** The Core detail owns introductions, permissions and the tool catalog. */
export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [query, setQuery] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [dirty, setDirty] = useState(false)
  const [editor, setEditor] = useState<McpServer | 'new' | null>(null)
  const [removing, setRemoving] = useState<McpServer | null>(null)
  const operation = useRef<AbortController | null>(null), mounted = useRef(true)
  const load = useCallback(async () => {
    try { const next = await request('servers.list'); if (mounted.current) { setCatalog(next); setError('') } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '读取服务失败。') }
  }, [])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; operation.current?.abort() } }, [load])
  useEffect(() => { if (!editor) setDirty(false) }, [editor])
  useEffect(() => { void window.mossApp?.view?.setState({ dirty, busy: Boolean(busy) }).catch(() => {}) }, [dirty, busy])
  const run = async (method: Method, input: Input) => {
    if (operation.current) throw new Error('请等待当前操作完成。')
    const controller = new AbortController(); operation.current = controller; setBusy(method); setError('')
    try { const next = await request(method, input, controller.signal); if (mounted.current) setCatalog(next) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败。'); throw cause }
    finally { operation.current = null; if (mounted.current) setBusy('') }
  }
  const act = (method: Method, input: Input) => { void run(method, input).catch(() => {}) }
  const save = async (input: SaveInput) => { await run('servers.save', input); setEditor(null); setDirty(false) }
  const servers = catalog?.servers.filter(server => `${server.name} ${endpoint(server.config)}`.toLowerCase().includes(query.toLowerCase())) || []
  return <main className="app-shell" aria-label="MCP 服务管理" onChangeCapture={() => { if (editor) setDirty(true) }}><div className="workspace">
    <header className="page-toolbar"><div className="search-field"><Search size={15}/><input aria-label="搜索服务" placeholder="搜索连接…" value={query} onChange={event => setQuery(event.target.value)}/></div><div className="toolbar-actions"><button className="icon-button" aria-label="刷新服务列表" disabled={Boolean(busy)} onClick={() => void load()}><RefreshCw size={16}/></button><button className="button primary" disabled={!catalog || Boolean(busy)} onClick={() => setEditor('new')}><Plus size={16}/>添加服务</button></div></header>
    {error && <div className="banner error" role="alert"><CircleAlert size={16}/><span>{error}</span><button className="text-button" disabled={Boolean(busy)} onClick={() => void load()}>刷新列表</button></div>}
    {!catalog && !error && <p role="status">正在读取服务…</p>}
    {catalog && !servers.length && <div className="detail-empty"><Terminal size={28}/><h2>{query ? '没有匹配的服务' : '添加第一个 MCP 服务'}</h2><p>配置本地启动命令或远程服务地址。</p></div>}
    <div className="managed-services">{servers.map(server => {
      const state = status(server)
      return <section className="managed-service" key={server.name}>
        <div className="detail-header"><div className="connection-heading"><Terminal size={20}/><div><h2>{server.name}</h2><p>{endpoint(server.config)}</p></div></div><span className={`status-badge ${state.tone}`}>{state.label}</span></div>
        <div className="connection-controls"><label className="enable-control"><input type="checkbox" aria-label={`启用 ${server.name}`} checked={server.enabled} disabled={Boolean(busy)} onChange={event => act('servers.set-enabled', { name: server.name, enabled: event.target.checked })}/><span>启用服务</span></label><div className="detail-actions">
          <button className="button" disabled={Boolean(busy) || server.credentialsMissing} onClick={() => act('servers.inspect', { name: server.name })}><RefreshCw size={14}/>检查连接</button>
          {server.config.type !== 'stdio' && <><button className="button" disabled={Boolean(busy)} onClick={() => act('auth.start', { name: server.name })}><KeyRound size={14}/>授权</button><button className="text-button" disabled={Boolean(busy)} onClick={() => { if (confirm('清除这个连接的浏览器授权？')) act('auth.clear', { name: server.name }) }}>清除授权</button></>}
          <button className="icon-button" aria-label={`编辑 ${server.name}`} disabled={Boolean(busy)} onClick={() => setEditor(server)}><Pencil size={15}/></button><button className="icon-button danger" aria-label={`删除 ${server.name}`} disabled={Boolean(busy)} onClick={() => setRemoving(server)}><Trash2 size={15}/></button>
        </div></div>{server.check?.state === 'failed' && <p role="alert" className="error-message">{server.check.error}</p>}
      </section>
    })}</div>
    {busy && <div className="banner" role="status"><Loader2 size={16} className="spin"/><span>{busy === 'servers.inspect' ? '正在检查连接' : busy === 'auth.start' ? '等待授权' : '正在保存更改'}</span><button className="text-button" onClick={() => operation.current?.abort()}>取消</button></div>}
  </div>{editor && <ServerEditor server={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={save}/>}
    {removing && <Dialog compact title="删除连接？" onClose={() => setRemoving(null)} busy={Boolean(busy)}><div className="confirmation-body">将删除 {removing.name} 的连接及保存的凭据。</div><footer className="dialog-footer"><button className="button" disabled={Boolean(busy)} onClick={() => setRemoving(null)}>取消</button><button className="button destructive" disabled={Boolean(busy)} onClick={() => void run('servers.remove', { name: removing.name }).then(() => setRemoving(null)).catch(() => {})}>删除</button></footer></Dialog>}
  </main>
}
