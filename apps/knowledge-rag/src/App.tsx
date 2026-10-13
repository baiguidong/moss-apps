import React, { useEffect, useRef, useState } from 'react'
import { BookOpen, Search, Upload, Settings, RefreshCw, FileText, ChevronRight, ArrowLeft, LoaderCircle, X, CheckCircle2, Database } from 'lucide-react'
import { client, request, type Document, type EngineStatus } from './lib/api'

import { EngineSetup } from './components/engine-setup'

const labels: Record<string, string> = { 'not-installed': '等待准备', installing: '准备中', starting: '启动中', ready: '已连接', failed: '需要处理' }
export default function App() {
  const [status, setStatus] = useState<EngineStatus | null>(null), [view, setView] = useState<'library' | 'settings'>('library')
  const [items, setItems] = useState<Document[]>([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0), [next, setNext] = useState<number | null>(null)
  const [query, setQuery] = useState(''), [searched, setSearched] = useState(''), [document, setDocument] = useState<Document | null>(null)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const reader = useRef<HTMLDialogElement>(null)
  const sequence = useRef(0), readSequence = useRef(0), mounted = useRef(true), abort = useRef<AbortController | null>(null)
  const ready = status?.state === 'ready', indexing = Boolean(status?.reindex?.active)
  async function load(search = searched, page = offset) {
    if (!ready) return
    const id = ++sequence.current
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    setLoading(true)
    try {
      const result = await request<{ items: Document[]; total?: number; nextOffset?: number | null }>(search ? 'documents.search' : 'documents.list', search ? { query: search, limit: 20 } : { offset: page, limit: 50 }, controller.signal)
      if (mounted.current && id === sequence.current) { setItems(result.items); setTotal(result.total ?? result.items.length); setNext(result.nextOffset ?? null); setError('') }
    } catch (cause) { if (mounted.current && !controller.signal.aborted && id === sequence.current) setError(String((cause as Error).message)) }
    finally { if (mounted.current && id === sequence.current) setLoading(false) }
  }
  useEffect(() => {
    const navigate = () => setView(location.hash === '#/engine-settings' ? 'settings' : 'library')
    navigate(); window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => { if (document && reader.current && !reader.current.open) reader.current.showModal() }, [document])
  useEffect(() => {
    mounted.current = true
    let active = true, pending = false, revision = 0
    async function refresh() {
      if (pending || !active) return
      pending = true
      const current = revision
      try { const state = await request<EngineStatus>('engine.status'); if (active && current === revision) setStatus(state) }
      catch (cause) { if (active) setError((cause as Error).message) }
      finally { pending = false }
    }
    void refresh()
    const interval = setInterval(() => void refresh(), 2500)
    const stop = client?.events.on('knowledge.changed', value => {
      const state = value as EngineStatus
      if (!active || !state?.state) return
      ++revision
      setStatus(previous => ({ ...state, reindex: state.state === 'ready' ? previous?.reindex : undefined }))
    })
    const off = client?.events.on('runtime', () => { void refresh() })
    return () => { active = false; mounted.current = false; ++readSequence.current; abort.current?.abort(); clearInterval(interval); stop?.(); off?.() }
  }, [])
  useEffect(() => { if (ready) void load() }, [ready, indexing])
  async function run(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation() }
    catch (cause) { if (mounted.current) setError((cause as Error).message) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function open(item: Document, append = false) {
    const id = ++readSequence.current
    try {
      const result = await request<Document>('documents.read', { filepath: item.filepath, offset: append ? document?.nextOffset ?? 0 : 0 })
      if (mounted.current && id === readSequence.current) setDocument(previous => append && previous?.filepath === result.filepath ? { ...result, content: (previous.content || '') + result.content } : result)
    } catch (cause) { if (mounted.current && id === readSequence.current) setError((cause as Error).message) }
  }
  async function importFiles() {
    await run(async () => {
      const { paths } = await request<{ paths: string[] }>('files.pick')
      if (!paths.length) return
      const result = await request<{ written: Document[]; failed: { filename: string; error: string }[] }>('files.import', { paths })
      setNotice(`已复制 ${result.written.length} 个文件，索引完成后即可搜索。`)
      if (result.failed.length) setError(result.failed.map(item => `${item.filename}：${item.error}`).join('\n'))
      setStatus(await request<EngineStatus>('engine.status'))
    })
  }

  return <div className="shell app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><BookOpen size={22} /></div><div><strong>语义知识库</strong><small>本地资料 · 语义检索</small></div></div>
      <nav><button className={view === 'library' ? 'active' : ''} onClick={() => { location.hash = '#/' }}><Database size={18} />我的资料<ChevronRight size={15} /></button><button className={view === 'settings' ? 'active' : ''} onClick={() => { location.hash = '#/engine-settings' }}><Settings size={18} />设置</button></nav>
      <div className="sidebar-foot"><span className={`dot ${ready ? 'online' : ''}`} />{labels[status?.state || ''] || '连接中'}<p>资料保存在本机<br />工具使用范围可在顶部设置中调整</p></div>
    </aside>
    <main>
      <header><div><h1>{view === 'settings' ? '知识库设置' : '我的资料'}</h1><p>{view === 'settings' ? '管理检索服务' : '用关键词或自然语言，找到资料中的线索。'}</p></div>{view === 'library' && <button className="primary" disabled={!ready || indexing || busy} onClick={() => void importFiles()}><Upload size={17} />导入文件</button>}</header>
      {error && <div role="alert" className="banner error">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      {notice && <div role="status" className="banner notice"><CheckCircle2 size={16}/>{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {!ready && <EngineSetup status={status} busy={busy}
        onStart={() => void run(async () => { setStatus(await request<EngineStatus>(status?.installed ? 'engine.start' : 'engine.prepare')) })}
        onCancel={() => void run(async () => { setStatus(await request<EngineStatus>('engine.cancel')) })}/>}
      {view === 'settings' ? <div className="settings-grid">
        <section className="card"><h2>检索引擎</h2><dl><dt>服务</dt><dd>knowledge-rag {status?.version || '4.11.0'}</dd><dt>检索</dt><dd>多语言语义 + 关键词</dd><dt>模型</dt><dd>{status?.model || 'intfloat/multilingual-e5-small'}</dd><dt>运行位置</dt><dd>本机 · CPU</dd><dt>连接</dt><dd>{status?.url || '等待启动'}</dd></dl><p>首次使用需要下载模型。默认关闭英文重排器。</p><button disabled={!ready || indexing || busy} onClick={() => void run(async () => { await request('index.rebuild'); setStatus(await request<EngineStatus>('engine.status')); setNotice('已提交重建索引，请查看进度。') })}><RefreshCw size={16}/>重新建立索引</button></section>
      </div> : ready ? <>
        <form className="search" onSubmit={event => { event.preventDefault(); const text = query.trim(); setSearched(text); setOffset(0); void load(text, 0) }}><Search size={20}/><input aria-label="搜索资料" placeholder="例如：客户不想续费时，有哪些处理方案？" value={query} onChange={event => setQuery(event.target.value)} maxLength={1000}/><button disabled={!ready || loading} type="submit">{loading ? '搜索中…' : '搜索'}</button></form>
        {indexing && <div role="status" className="indexing"><LoaderCircle size={16} className="spin"/>正在建立索引 {status?.reindex?.progress || ''}<progress max={100} value={status?.reindex?.percent || 0}/></div>}
        {(status?.reindex?.last_error || status?.reindex?.last_result?.errors) ? <div role="alert" className="banner error">索引未全部成功：{status.reindex.last_error || `${status.reindex.last_result?.errors} 个文件处理失败`}</div> : null}
        <div className="list-heading"><span>{searched ? `“${searched}” 的检索结果` : `已入库 · ${total} 份资料`}</span><button disabled={!ready || loading} onClick={() => { setQuery(''); setSearched(''); setOffset(0); void load('', 0) }}>{searched ? '查看全部' : '刷新'}</button></div>
        <div className="documents">{items.map((item, index) => <button className="document" key={`${item.filepath}:${index}`} onClick={() => void open(item)}><div className="file-icon"><FileText size={20}/></div><div><strong>{item.filename}</strong><small>{item.category || 'general'}</small>{item.content && <p>{item.content.slice(0, 360)}</p>}</div><ChevronRight size={18}/></button>)}</div>
        {!items.length && <div className="empty"><FileText size={34}/><h2>{loading ? '正在查找资料…' : searched ? '暂时没有找到相关内容' : '从一份资料开始'}</h2><p>{searched ? '换一种问法，或确认资料已经完成索引。' : '导入 Markdown、PDF、Office 或文本文件，建立自己的知识库。'}</p></div>}
        {(offset > 0 || next !== null) && <div className="pagination"><button disabled={offset === 0 || loading} onClick={() => { const page = Math.max(0, offset - 50); setOffset(page); void load('', page) }}>上一页</button><span>第 {Math.floor(offset / 50) + 1} 页</span><button disabled={next === null || loading} onClick={() => { if (next !== null) { setOffset(next); void load('', next) } }}>下一页</button></div>}
      </> : null}
    </main>
    {document && <dialog ref={reader} aria-label="阅读资料" className="reader" onCancel={() => { ++readSequence.current; setDocument(null) }}><header><button aria-label="关闭阅读" onClick={() => { ++readSequence.current; setDocument(null) }}><ArrowLeft size={18}/>返回</button><h2>{document.filename}</h2></header><p className="source">{document.filepath}</p><pre className="content">{document.content}</pre>{document.nextOffset != null && <button onClick={() => void open(document, true)}>继续阅读</button>}</dialog>}
  </div>
}
