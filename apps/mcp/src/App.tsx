import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronRight, CircleAlert, CircleCheck, Code2, Globe2, KeyRound, Loader2, Pencil, Plug, Plus, RefreshCw, Search, ShieldCheck, Terminal, Trash2, Unplug, Wrench, X } from 'lucide-react'
import { endpoint, status, type Catalog, type Input, type McpServer, type Method, type SaveInput } from './contracts'
import { request, runtimeStatus } from './lib/api'
import { ServerEditor } from './components/server-editor'
import { Dialog } from './components/dialog'

function ServerIcon({ server, large = false }: { server: McpServer; large?: boolean }) {
  const Icon = server.config.type === 'stdio' ? Terminal : Globe2
  return <span className={`server-icon ${large ? 'large' : ''} ${server.config.type === 'stdio' ? 'local' : ''}`}><Icon size={large ? 24 : 18} strokeWidth={1.7} /></span>
}
function Badge({ server }: { server: McpServer }) { const s = status(server); return <span className={`status-badge ${s.tone}`}><i />{s.label}</span> }
const date = (time: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time)

export function App() {
  const [catalog, setCatalog] = useState<Catalog>({ servers: [] })
  const [selectedName, setSelectedName] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const [tab, setTab] = useState('tools'), [toolQuery, setToolQuery] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<McpServer | 'new' | null>(null), [confirmation, setConfirmation] = useState<'remove' | 'auth.clear' | null>(null)
  const [runtime, setRuntime] = useState({ state: 'starting', label: '正在启动' })
  const mounted = useRef(true), operation = useRef<AbortController | null>(null), loadVersion = useRef(0)
  const refreshRuntime = useCallback(() => { void runtimeStatus().then(value => { if (mounted.current) setRuntime(value) }).catch(() => { if (mounted.current) setRuntime({ state: 'error', label: '运行状态不可用' }) }) }, [])
  const load = useCallback(async () => {
    const version = ++loadVersion.current
    setLoading(true)
    try { const result = await request('servers.list'); if (mounted.current && version === loadVersion.current) { setCatalog(result); setError('') } }
    catch (cause) { if (mounted.current && version === loadVersion.current) setError(cause instanceof Error ? cause.message : '连接列表加载失败。') }
    finally { if (mounted.current && version === loadVersion.current) setLoading(false); refreshRuntime() }
  }, [refreshRuntime])
  useEffect(() => {
    mounted.current = true; void load(); refreshRuntime()
    const off = window.mossApp?.events.on('runtime', () => refreshRuntime())
    return () => { mounted.current = false; operation.current?.abort(); off?.() }
  }, [load, refreshRuntime])
  const servers = catalog.servers
  const visible = servers.filter(server => (filter === 'all' || server.enabled === (filter === 'enabled')) && `${server.name} ${endpoint(server.config)}`.toLowerCase().includes(query.toLowerCase()))
  const selected = visible.find(server => server.name === selectedName) || visible[0]
  const tools = (selected?.check?.tools || []).filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(toolQuery.toLowerCase()))
  const unavailable = !['running', 'starting', 'demo'].includes(runtime.state)
  const run = async (method: Method, input: Input, success?: string) => {
    if (operation.current) throw new Error('请等待当前操作完成。')
    const controller = new AbortController(); operation.current = controller
    ++loadVersion.current; setLoading(false); setBusy(method); setError(''); setNotice('')
    try {
      const result = await request(method, input, controller.signal)
      if (!mounted.current) return
      setCatalog(result)
      if (success) setNotice(`${success}${result.skippedBusySessionCount ? '，进行中的对话将在结束后更新。' : '。'}`)
    } finally { operation.current = null; if (mounted.current) { setBusy(''); refreshRuntime() } }
  }
  const act = (method: Method, input: Input, success?: string) => {
    void run(method, input, success).catch(cause => { if (mounted.current) setError(cause?.name === 'AbortError' ? '操作已取消。' : cause instanceof Error ? cause.message : '操作失败，请重试。') })
  }
  const save = async (input: SaveInput) => { await run('servers.save', input, '连接已保存'); setSelectedName(input.name); setFilter('all'); setQuery('') }
  const connectedCount = servers.filter(server => server.enabled && server.check?.state === 'connected').length
  return <main className="app-shell"><div className="workspace">
    <header className="page-header"><div className="page-heading"><span className="app-mark"><Plug size={24} strokeWidth={1.7} /></span><div><div className="eyebrow">工具与连接</div><h1>MCP <span>让工具融入对话</span></h1></div></div><button className="button primary" onClick={() => setEditor('new')} disabled={Boolean(busy) || unavailable}><Plus size={17} />添加服务</button></header>
    <div className="overview-strip"><span><strong>{servers.length}</strong> 个服务</span><span><i className="dot primary-dot" /><strong>{servers.filter(s => s.enabled).length}</strong> 已启用</span><span><CircleCheck size={14} /><strong>{connectedCount}</strong> 检查通过</span><div className="strip-end">{!window.mossApp ? <span className="demo-label">演示数据 · 操作不会连接真实服务</span> : <><ShieldCheck size={14} />凭据加密保存</>}</div></div>
    {error && <div className="banner error" role="alert"><CircleAlert size={17} /><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></div>}
    {notice && <div className="banner success" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {unavailable && <div className="banner error" role="status"><CircleAlert size={17} /><span>{runtime.label}，请在 Moss 应用管理中检查启用状态与权限。</span><button className="text-button" onClick={() => { refreshRuntime(); void load() }}>重试</button></div>}
    <section className="connection-workspace" aria-label="MCP 服务管理">
      <aside className="sidebar"><div className="sidebar-heading"><h2>我的连接 <span>{servers.length}</span></h2><button className="icon-button" aria-label="刷新服务列表" title="刷新服务列表" disabled={loading || Boolean(busy)} onClick={() => void load()}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div>
        <div className="search-field"><Search size={15} /><input aria-label="搜索服务" placeholder="搜索连接…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="filters" role="group" aria-label="筛选服务">{[['all', '全部'], ['enabled', '已启用'], ['disabled', '已停用']].map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <nav className="server-list" aria-label="服务列表">{loading && !servers.length ? <div className="list-loading"><Loader2 size={18} className="spin" />正在加载连接</div> : visible.map(server => <button key={server.name} className={`server-row ${selected?.name === server.name ? 'selected' : ''}`} aria-current={selected?.name === server.name ? 'true' : undefined} onClick={() => { setSelectedName(server.name); setToolQuery(''); setTab('tools'); setError('') }}><ServerIcon server={server} /><span className="server-row-body"><strong>{server.name}</strong><span>{server.config.type === 'stdio' ? '本地进程' : server.config.type.toUpperCase()}<i>·</i>{!server.enabled ? '已停用' : server.check?.state === 'connected' ? `${server.check.tools.length} 个工具` : status(server).label}</span></span><ChevronRight size={14} /></button>)}
        {!loading && !visible.length && <div className="list-empty"><Search size={20} /><span>{servers.length ? '没有匹配的连接' : '还没有添加服务'}</span>{servers.length > 0 && <button className="text-button" onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</button>}</div>}</nav>
        <div className="sidebar-footer"><KeyRound size={14} /><span>你的工具，由你掌控</span></div>
      </aside>
      <div className="detail-pane">{selected ? <>
        <header className="detail-header"><div className="connection-heading"><ServerIcon server={selected} large /><div><div className="connection-title"><h2>{selected.name}</h2><Badge server={selected} /></div><p>{endpoint(selected.config)}</p></div></div><div className="detail-actions"><button className="icon-button" aria-label="编辑连接" title="编辑连接" disabled={Boolean(busy) || unavailable} onClick={() => setEditor(selected)}><Pencil size={16} /></button><button className="icon-button danger" aria-label="删除连接" title="删除连接" disabled={Boolean(busy) || unavailable} onClick={() => setConfirmation('remove')}><Trash2 size={16} /></button></div></header>
        <div className="connection-controls"><div className="enable-control"><button className="switch" role="switch" aria-label={`启用 ${selected.name}`} aria-checked={selected.enabled} disabled={Boolean(busy) || unavailable} onClick={() => act('servers.set-enabled', { name: selected.name, enabled: !selected.enabled }, selected.enabled ? '服务已停用' : '服务已启用')}><span /></button><span>{selected.enabled ? '已启用' : '已停用'}<small>{selected.enabled ? '可在本地对话中使用' : '开启后向对话提供工具'}</small></span></div><div className="check-actions">{busy === 'servers.inspect' || busy === 'auth.start' ? <button className="button" onClick={() => operation.current?.abort()}><Loader2 size={15} className="spin" />{busy === 'auth.start' ? '等待授权' : '检查中'}<span className="cancel-label">取消</span></button> : <button className="button" onClick={() => act('servers.inspect', { name: selected.name })} disabled={Boolean(busy) || unavailable || selected.credentialsMissing}><RefreshCw size={15} />检查连接</button>}{selected.check?.state === 'needs-auth' && <button className="button primary" disabled={Boolean(busy) || unavailable} onClick={() => act('auth.start', { name: selected.name }, '授权已完成')}><KeyRound size={15} />去授权</button>}</div></div>
        <div className="detail-tabs" role="tablist" aria-label="连接详情"><button role="tab" aria-selected={tab === 'tools'} className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}><Wrench size={15} />可用工具{selected.check?.state === 'connected' && <span>{selected.check.tools.length}</span>}</button><button role="tab" aria-selected={tab === 'config'} className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}><Code2 size={15} />连接配置</button></div>
        {tab === 'tools' ? <div className="tools-panel" role="tabpanel" aria-label="可用工具">{selected.check?.state === 'connected' ? <><div className="tools-heading"><div><h3>工具目录</h3><p>对话会按需使用已启用的工具。</p></div><div className="search-field compact-search"><Search size={14} /><input aria-label="搜索工具" placeholder="查找工具" value={toolQuery} onChange={e => setToolQuery(e.target.value)} /></div></div><div className="tools-list">{tools.map(tool => <div className="tool-row" key={tool.name}><span className="tool-icon"><Wrench size={16} /></span><div><h4>{tool.name}{tool.disabled && <span className="muted-badge">已排除</span>}</h4><p>{tool.description || '此工具未提供描述。'}</p></div></div>)}</div>{!tools.length && <div className="small-empty">{toolQuery ? '没有匹配的工具' : '服务已连接，目前没有提供工具。'}</div>}<div className="check-footnote"><CircleCheck size={13} /><span>检查于 {date(selected.check.checkedAt)}{selected.check.durationMs !== undefined && ` · ${selected.check.durationMs} ms`}{selected.check.truncated && ` · 仅展示前 ${selected.check.tools.length} 项`}</span></div></> : <div className="detail-empty"><div className="empty-illustration"><Plug size={32} strokeWidth={1.4} /><span><Wrench size={14} /></span></div><h3>{selected.check?.state === 'failed' ? '暂时无法连接到服务' : selected.credentialsMissing ? '补充凭据，继续连接' : selected.check?.state === 'needs-auth' ? '完成授权，连接你的工具' : '看看这个服务能做什么'}</h3><p>{selected.check?.state === 'failed' ? selected.check.error : selected.credentialsMissing ? '该服务的凭据已被清除，编辑连接后重新填写。' : selected.check?.state === 'needs-auth' ? '服务需要验证你的身份，授权后即可检查工具列表。' : '检查连接后，这里会展示服务提供的工具及使用说明。'}</p><button className="button" disabled={Boolean(busy) || unavailable} onClick={() => selected.credentialsMissing ? setEditor(selected) : act(selected.check?.state === 'needs-auth' ? 'auth.start' : 'servers.inspect', { name: selected.name })}>{selected.check?.state === 'needs-auth' ? '开始授权' : selected.credentialsMissing ? '编辑连接' : '检查连接'}<ArrowRight size={15} /></button></div>}</div> : <div className="config-panel" role="tabpanel" aria-label="连接配置"><div className="section-title"><h3>连接信息</h3><button className="text-button" onClick={() => setEditor(selected)} disabled={Boolean(busy) || unavailable}><Pencil size={14} />编辑</button></div><dl><div><dt>连接方式</dt><dd>{selected.config.type === 'stdio' ? '本地进程 · stdio' : selected.config.type === 'http' ? 'HTTP · Streamable HTTP' : 'SSE · Server-Sent Events'}</dd></div><div><dt>{selected.config.type === 'stdio' ? '启动命令' : '服务地址'}</dt><dd className="mono">{selected.config.command || selected.config.url}</dd></div>{selected.config.type === 'stdio' && <div><dt>启动参数</dt><dd className="mono">{selected.config.args?.length ? selected.config.args.map((arg, i) => <div key={i}>{arg}</div>) : '无'}</dd></div>}<div><dt>最近修改</dt><dd>{date(selected.updatedAt)}</dd></div></dl>
          <div className="section-title"><h3>{selected.config.type === 'stdio' ? '环境变量' : '请求头'}</h3><span className="subtle"><KeyRound size={13} />已隐藏敏感值</span></div><div className="credential-list">{Object.keys(selected.config.env || selected.config.headers || {}).map(key => <div key={key}><code>{key}</code><span>••••••••</span></div>)}{!Object.keys(selected.config.env || selected.config.headers || {}).length && <p className="subtle">未配置额外凭据</p>}</div>
          {selected.config.type !== 'stdio' && <div className="auth-section"><div><h3>浏览器授权</h3><p>需要 OAuth 的服务可在浏览器中完成授权。</p></div><div><button className="button" disabled={Boolean(busy) || unavailable} onClick={() => act('auth.start', { name: selected.name }, '授权已完成')}><KeyRound size={14} />授权</button><button className="text-button" disabled={Boolean(busy) || unavailable} onClick={() => setConfirmation('auth.clear')}>清除授权</button></div></div>}
        </div>}
      </> : <div className="detail-empty full-empty"><div className="empty-illustration"><Unplug size={34} strokeWidth={1.4} /></div><h2>{servers.length ? '没有匹配的服务' : '连接你的第一个工具服务'}</h2><p>{servers.length ? '试试其他关键词，或清除左侧筛选。' : '接入本地或远程 MCP 服务，让文件、知识与常用工具在对话中触手可及。'}</p>{!servers.length && <button className="button primary" onClick={() => setEditor('new')} disabled={Boolean(busy) || unavailable}><Plus size={16} />添加服务</button>}</div>}</div>
    </section><footer className="page-footer"><span><i className={`dot ${runtime.state === 'running' ? 'primary-dot' : ''}`} />{runtime.label}</span><span>MCP · Model Context Protocol</span></footer>
  </div>{editor && <ServerEditor server={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={save} />}
  {confirmation && selected && <Dialog compact title={confirmation === 'remove' ? '删除这个连接？' : '清除浏览器授权？'} onClose={() => setConfirmation(null)} busy={Boolean(busy)}><div className="confirmation-body"><p>{confirmation === 'remove' ? `将删除 ${selected.name} 的连接配置和保存的凭据。` : `下次使用 ${selected.name} 时可能需要重新授权。`}</p><p className="subtle">进行中的对话将在结束后更新。</p></div><footer className="dialog-footer"><button className="button" disabled={Boolean(busy)} onClick={() => setConfirmation(null)}>取消</button><button className="button destructive" disabled={Boolean(busy)} onClick={() => { void run(confirmation === 'remove' ? 'servers.remove' : 'auth.clear', { name: selected.name }, confirmation === 'remove' ? '连接已删除' : '授权已清除').then(() => setConfirmation(null)).catch(cause => { setConfirmation(null); setError(cause.message) }) }}>{busy && <Loader2 size={15} className="spin" />}{confirmation === 'remove' ? '删除连接' : '清除授权'}</button></footer></Dialog>}
  </main>
}
