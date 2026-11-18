import { useEffect, useRef, useState } from 'react'
import { Activity, BarChart3, BookOpen, CheckCircle2, Database, LoaderCircle, RefreshCw, Settings, X } from 'lucide-react'
import { client, request, type EngineStatus } from './lib/api'
import { EngineSetup } from './components/engine-setup'
import { Library } from './components/library'
import { IndexTools, RetrievalEvaluation } from './components/index-tools'

const labels: Record<string, string> = { 'not-installed': '等待准备', installing: '准备中', starting: '启动中', ready: '已连接', failed: '需要处理' }
const views = [
  { route: '#/', label: '我的资料', icon: Database },
  { route: '#/index', label: '索引任务', icon: Activity },
  { route: '#/evaluation', label: '检索评测', icon: BarChart3 },
  { route: '#/engine-settings', label: '设置', icon: Settings },
]
function currentRoute() { return views.find(view => view.route === location.hash)?.route || '#/' }

export default function App() {
  const [status, setStatus] = useState<EngineStatus | null>(null), [view, setView] = useState(currentRoute)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  const refreshStatus = useRef<() => void>(() => {})
  const ready = status?.state === 'ready', indexing = Boolean(status?.reindex?.active)
  const wasIndexing = useRef(false)
  useEffect(() => {
    if (wasIndexing.current && !indexing) setRevision(value => value + 1)
    wasIndexing.current = indexing
  }, [indexing])
  useEffect(() => {
    const navigate = () => { setView(currentRoute()); setNotice(''); setError('') }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    let active = true, pending = false, generation = 0
    async function refresh() {
      if (pending || !active) return
      pending = true
      const current = generation
      try { const next = await request<EngineStatus>('engine.status'); if (active && current === generation) setStatus(next) }
      catch (cause) { if (active) setError((cause as Error).message) }
      finally { pending = false }
    }
    refreshStatus.current = refresh
    void refresh()
    const interval = setInterval(refresh, 2500)
    const stop = client?.events.on('knowledge.changed', value => {
      const state = value as EngineStatus
      if (!active || !state?.state) return
      ++generation
      setStatus(previous => ({ ...state, reindex: state.state === 'ready' ? previous?.reindex : undefined }))
    })
    const off = client?.events.on('runtime', refresh)
    return () => { active = false; clearInterval(interval); stop?.(); off?.() }
  }, [])
  function refreshData() { setRevision(n => n + 1); refreshStatus.current() }
  async function refreshAfterIndexRequest() {
    // A short reindex can finish between two polls. Read status after submission
    // before refreshing the list, even if a previous heartbeat is still pending.
    setStatus(await request<EngineStatus>('engine.status'))
    setRevision(n => n + 1)
  }
  async function run(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  function rebuild(mode: string) {
    void run(async () => {
      const result = await request<{ status: string }>('index.rebuild', { mode })
      setNotice(result.status === 'already_running' ? '索引任务正在运行。' : '已提交索引任务。')
      await refreshAfterIndexRequest()
    })
  }
  return <div className="shell app-shell">
    <aside className="sidebar"><div className="brand"><BookOpen size={23}/><strong>语义知识库</strong></div>
      <nav aria-label="知识库导航">{views.map(({ route, label, icon: Icon }) => <button key={route} title={label} aria-current={view === route ? 'page' : undefined} className={view === route ? 'active' : ''} onClick={() => { location.hash = route }}><Icon size={17}/>{label}</button>)}</nav>
      <div className="sidebar-foot"><span className={'dot ' + (ready ? 'online' : '')}/>{labels[status?.state || ''] || '连接中'}<p>资料保存在本机</p></div>
    </aside>
    <main>
      {error && <div role="alert" className="banner error">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      {notice && <div role="status" className="banner notice"><CheckCircle2 size={16}/>{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {!ready && <><header><h1>{views.find(v => v.route === view)?.label}</h1></header><EngineSetup status={status} busy={busy} cancelling={cancelling}
        onStart={() => void run(async () => setStatus(await request<EngineStatus>(status?.installed ? 'engine.start' : 'engine.prepare')))}
        onOffline={() => void run(async () => setStatus(await request<EngineStatus>('engine.prepareOffline')))}
        onPrepare={() => void run(async () => setStatus(await request<EngineStatus>('engine.prepare')))}
        onCancel={() => {
          setCancelling(true)
          void request<EngineStatus>('engine.cancel').then(setStatus).catch(cause => setError(cause.message)).finally(() => setCancelling(false))
        }}/></>}
      {indexing && view !== '#/index' && <div role="status" className="indexing"><LoaderCircle size={16} className="spin"/>正在建立索引 {status?.reindex?.progress}<progress max={100} value={status?.reindex?.percent || 0}/></div>}
      {view !== '#/index' && (status?.reindex?.last_error || status?.reindex?.last_result?.errors) ? <div role="alert" className="banner error">索引未全部成功：{status.reindex.last_error || status.reindex.last_result?.errors + ' 个文件处理失败'}</div> : null}
      {ready && view === '#/' && <Library indexing={indexing} revision={revision} onRefresh={refreshData} onIndexed={refreshAfterIndexRequest} onNotice={setNotice}/>}
      {ready && view === '#/index' && <IndexTools status={status} revision={revision} refresh={refreshData} rebuild={rebuild} busy={busy}/>}
      {ready && view === '#/evaluation' && <RetrievalEvaluation/>}
      {view === '#/engine-settings' && <>
        {ready && <header><h1>知识库设置</h1></header>}<section className="card"><h2>检索引擎</h2>
          <dl><dt>服务</dt><dd>knowledge-rag {status?.version || '4.11.0'}</dd><dt>检索</dt><dd>多语言语义 + 关键词</dd>
            <dt>模型</dt><dd>{status?.model || 'intfloat/multilingual-e5-small'}</dd><dt>运行位置</dt><dd>本机 · CPU</dd>
            <dt>运行环境</dt><dd>{status?.runtime?.python?.available ? 'Moss Python ' + (status.runtime.python.version || '已就绪') : status?.runtime?.python?.available === false ? 'Moss Python 未就绪' : '检查中…'}</dd>
            <dt>连接</dt><dd>{status?.url || '等待启动'}</dd></dl><p>引擎依赖安装在 App 的私有 Python 环境中。在线准备从 PyPI 安装依赖、从 Hugging Face 下载模型。离线准备从本地资源包读取两者。</p>
          <button disabled={!ready || indexing || busy} onClick={() => rebuild('smart')}><RefreshCw size={16}/>重新建立索引</button>
        </section></>}
    </main>
  </div>
}
