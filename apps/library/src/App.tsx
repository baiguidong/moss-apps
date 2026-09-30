import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, FolderPlus, FolderOpen, Upload, Plus, Search, Pencil, Trash2, X, RefreshCw, LoaderCircle, Library, ArrowLeft, ExternalLink } from 'lucide-react'
import type { Api, Collection, Document, Job, Source } from './lib/api'
const stateName = (value: string) => ({ ready: '已索引', completed: '已完成', failed: '失败', stale: '待更新', discovered: '待索引', running: '处理中', queued: '排队中', cancelled: '已取消', idle: '待处理' }[value] || value)
type Modal = { kind: 'collection' | 'rename' | 'note' | 'edit' | 'delete-doc' | 'delete-collection' | 'import'; title: string; content: string; target: string; resourceId?: string; revision?: string; paths?: string[] }
export function App({ api }: { api: Api }) {
  const [collections, setCollections] = useState<Collection[]>([]), [selected, setSelected] = useState('')
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [docs, setDocs] = useState<Document[]>([])
  const [doc, setDoc] = useState<Document | null>(null), [jobs, setJobs] = useState<Job[]>([]), [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<Modal | null>(null), [modalError, setModalError] = useState(''), [tab, setTab] = useState<'docs' | 'jobs'>('docs')
  const [python, setPython] = useState(true), [page, setPage] = useState(0)
  const epoch = useRef(0), docEpoch = useRef(0)
  const current = collections.find(c => c.id === selected)
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(0) }, 250); return () => clearTimeout(timer) }, [query])
  const reload = useCallback(async () => {
    const ticket = ++epoch.current
    try {
      const cs = await api.request<Collection[]>('collections.list')
      if (ticket !== epoch.current) return
      const scope = cs.some(c => c.id === selected) ? selected : ''
      if (selected && !scope) { setSelected(''); setPage(0) }
      const [ds, js, ss, status] = await Promise.all([ api.request<Document[]>(search ? 'documents.search' : 'documents.list', { ...(scope ? { collectionIds: [scope] } : {}), ...(search ? { query: search } : { offset: page * 50 }), limit: 50 }),
        api.request<Job[]>('jobs.list', { limit: 30 }), api.request<Source[]>('sources.list', scope ? { collectionId: scope } : {}), api.request<{ pythonAvailable: boolean }>('status.get'),
      ])
      if (ticket !== epoch.current) return
      setCollections(cs); setDocs(ds); setJobs(js); setSources(ss); setPython(status.pythonAvailable); setError('')
    } catch (e) { if (ticket === epoch.current) setError(String((e as Error).message || e)) }
    finally { if (ticket === epoch.current) setLoading(false) }
  }, [api, selected, search, page])
  useEffect(() => {
    setLoading(true); void reload()
    let timer: ReturnType<typeof setTimeout>
    const stop = api.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => void reload(), 180) })
    const polling = setInterval(() => void reload(), 5000)
    return () => { stop(); clearTimeout(timer); clearInterval(polling); epoch.current++ }
  }, [api, reload])
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); await reload() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const open = async (id: string) => {
    const ticket = ++docEpoch.current
    try { const result = await api.request<Document>('documents.read', { resourceId: id }); if (ticket === docEpoch.current) setDoc(result) }
    catch (e) { setError((e as Error).message) }
  }
  const showModal = (kind: Modal['kind']) => { setModalError(''); setModal({ kind, title: ['edit', 'delete-doc'].includes(kind) ? doc!.title : ['rename', 'delete-collection'].includes(kind) ? current!.name : '', content: kind === 'edit' ? doc!.content || '' : '', target: selected || collections[0]?.id || '', resourceId: doc?.id, revision: kind === 'delete-doc' ? doc?.currentRevision || doc?.revision : doc?.revision }) }
  const pick = (kind: 'file' | 'directory') => void run(async () => {
    const result = await api.request<{ paths: string[] }>('local.pick', { kind })
    if (result.paths.length) { setModalError(''); setModal({ kind: 'import', title: '', content: '', target: selected || collections[0]?.id || '', paths: result.paths }) }
  })
  const submit = async () => {
    if (!modal) return
    setBusy(true); setModalError('')
    try {
      if (modal.kind === 'collection') { const c = await api.request<Collection>('collections.create', { name: modal.title }); setSelected(c.id); setPage(0) }
      if (modal.kind === 'rename') await api.request('collections.update', { id: modal.target, name: modal.title })
      if (modal.kind === 'note') { const result = await api.request<{ resource: Document }>('documents.create', { collectionId: modal.target, title: modal.title, content: modal.content }); await open(result.resource.id) }
      if (modal.kind === 'edit') { await api.request('documents.update', { resourceId: modal.resourceId!, revision: modal.revision!, title: modal.title, content: modal.content }); await open(modal.resourceId!) }
      if (modal.kind === 'delete-doc') { await api.request('documents.delete', { resourceId: modal.resourceId!, revision: modal.revision! }); docEpoch.current++; setDoc(null) }
      if (modal.kind === 'delete-collection') { await api.request('collections.delete', { id: modal.target }); setSelected(''); docEpoch.current++; setDoc(null); setPage(0) }
      if (modal.kind === 'import') {
        const result = await api.request<{ writtenCount: number; failedCount: number; written: unknown[]; failed: { path: string; error: string }[] }>('files.import', { collectionId: modal.target, paths: modal.paths })
        setNotice(`已导入 ${result.writtenCount} 个文件，处理进度可在索引任务中查看。`)
        if (result.failed.length) { setModalError(`共 ${result.failedCount} 个文件失败。\n` + result.failed.map(f => `${f.path}：${f.error}`).join('\n')); await reload(); return }
      }
      setModal(null); await reload()
    } catch (e) { setModalError((e as Error).message) } finally { setBusy(false) }
  }
  const active = jobs.filter(j => ['queued', 'running'].includes(j.status)).length
  return <main className="app-shell">
    {api.demo && <div className="demo">浏览器演示 · 修改仅保留在本次预览中</div>}
    <div className="layout">
      <aside className="sidebar">
        <div className="brand"><Library size={21} /><strong>我的知识</strong></div>
        <button className={!selected ? 'nav selected' : 'nav'} onClick={() => { setSelected(''); setPage(0); setTab('docs') }}><BookOpen size={17} />全部资料<span>{collections.reduce((sum, c) => sum + c.resourceCount, 0)}</span></button>
        <div className="section-label">资料集<button aria-label="新建资料集" title="新建资料集" onClick={() => showModal('collection')}><Plus size={16} /></button></div>
        <nav aria-label="资料集">{collections.map(c => <button key={c.id} className={selected === c.id ? 'nav selected' : 'nav'} onClick={() => { setSelected(c.id); setPage(0); setTab('docs') }}><FolderOpen size={16} /><span className="collection-name">{c.name}</span><small>{c.resourceCount}</small></button>)}</nav>
        <div className="sidebar-bottom"><button className={tab === 'jobs' ? 'nav selected' : 'nav'} onClick={() => setTab(tab === 'jobs' ? 'docs' : 'jobs')}><RefreshCw size={16} />索引任务{active > 0 && <span>{active}</span>}</button><p>资料保存在本机<br />可在任意会话中查询</p></div>
      </aside>
      <section className="workspace">
        <header className="toolbar"><div className="heading"><h2>{current?.name || '全部资料'}</h2><span>{search ? '全文搜索' : `${docs.length} 篇文档${page ? ` · 第 ${page + 1} 页` : ''}`}</span></div>
          {current && <><button className="icon" aria-label="重命名资料集" onClick={() => showModal('rename')}><Pencil size={16} /></button><button className="icon" aria-label="删除资料集" onClick={() => showModal('delete-collection')}><Trash2 size={16} /></button></>}
          <div className="toolbar-actions"><button disabled={busy || !collections.length} onClick={() => pick('directory')}><FolderPlus size={16} />导入目录</button><button disabled={busy || !collections.length} onClick={() => pick('file')}><Upload size={16} />导入文件</button><button className="primary" disabled={busy || !collections.length} onClick={() => showModal('note')}><Plus size={16} />新建文档</button></div>
        </header>
        {error && <div role="alert" className="banner error">{error}<button onClick={() => void reload()}>重试</button></div>}
        {!python && <div role="alert" className="banner error">Python 运行环境尚未就绪，文档可保存，索引需要在 Moss 设置中完成运行环境安装，然后重启知识库应用并重新索引。</div>}
        {notice && <div role="status" className="banner">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {tab === 'docs' ? <>
          <div className="search-bar"><Search size={18} /><input aria-label="搜索文档" placeholder={current ? `搜索「${current.name}」中的内容…` : '搜索全部资料集中的内容…'} value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={16} /></button>}</div>
          <div className={`content-area ${doc ? 'has-document' : ''}`}>
            <div className="document-list">
              {loading ? <div className="empty"><LoaderCircle className="spin" />正在读取资料…</div> : !docs.length ? <div className="empty"><BookOpen size={36} /><h3>{search ? '没有找到相关文档' : '开始积累你的知识'}</h3><p>{search ? '试试更短的关键词，或选择全部资料。' : '导入文件、目录，或直接创建一篇文档。'}</p></div> : docs.map((d, idx) => <button key={`${d.resourceId || d.id}-${idx}`} className={`document-row ${doc?.id === (d.resourceId || d.id) ? 'selected' : ''}`} onClick={() => void open(d.resourceId || d.id)}><FileText size={21} /><div><strong>{d.title}</strong><small>{d.relativePath}</small>{d.snippet && <p>{d.snippet}</p>}</div><span className={`status ${d.status === 'failed' ? 'danger' : ''}`}>{search ? d.extension : stateName(d.status)}</span></button>)}
              {!search && (page > 0 || docs.length === 50) && <div className="pagination"><button disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><button disabled={docs.length < 50} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
              {search && docs.length === 50 && <p className="footnote">显示最相关的 50 条结果，可缩小关键词或资料集范围。</p>}
            </div>
            {doc && <article className="reader"><div className="reader-tools"><button aria-label="关闭文档" onClick={() => { docEpoch.current++; setDoc(null) }}><ArrowLeft size={16} /></button><button aria-label="刷新文档" onClick={() => void open(doc.id)}><RefreshCw size={16} /></button><span />{doc.editable && <button onClick={() => showModal('edit')}><Pencil size={15} />编辑</button>}<button title="打开副本" aria-label="打开副本" disabled={busy} onClick={() => void run(async () => { await api.request('documents.open', { resourceId: doc.id, revision: doc.revision }) })}><ExternalLink size={16} /></button><button aria-label="删除文档" disabled={busy} onClick={() => showModal('delete-doc')}><Trash2 size={16} /></button></div><div className="reader-scroll"><h1>{doc.title}</h1><p className="reader-meta">{doc.relativePath} · {stateName(doc.status)}</p>{doc.error && <p role="alert">{doc.error}</p>}<pre className="document-content">{doc.content || (doc.status !== 'ready' ? '文档正在等待索引，可稍后刷新。' : '此文档没有可提取的文字。')}</pre>{!doc.editable && doc.nextOffset != null && <button disabled={busy} onClick={() => void run(async () => { const ticket = ++docEpoch.current; const next = await api.request<Document>('documents.read', { resourceId: doc.id, revision: doc.revision, chunkOffset: doc.nextOffset }); if (ticket === docEpoch.current) setDoc({ ...next, content: `${doc.content}\n\n${next.content}` }) })}>继续读取</button>}</div></article>}
          </div>
        </> : <div className="jobs-view"><h3>索引任务</h3><p>文件导入后自动建立全文索引。处理失败可重试对应来源。</p>{!jobs.length && <p className="empty">暂无索引任务</p>}{jobs.map(j => <div className="job" key={j.id}><div><strong>{sources.find(s => s.id === j.sourceId)?.name || j.progress.currentTitle || '文档索引'}</strong><small>{stateName(j.status)} · 已索引 {j.progress.indexed || 0} / {j.progress.discovered || 0}{j.progress.failed ? ` · ${j.progress.failed} 个失败` : ''}</small>{j.error && <p className="danger">{j.error}</p>}</div>{['queued', 'running'].includes(j.status) ? <button disabled={busy} onClick={() => void run(async () => { await api.request('jobs.cancel', { jobId: j.id }) })}>取消</button> : <button disabled={busy} onClick={() => void run(async () => { await api.request('sources.refresh', { sourceId: j.sourceId }) })}>重新索引</button>}</div>)}</div>}
      </section>
    </div>
    {modal && <div className="modal-overlay"><section role="dialog" aria-modal="true" aria-label={{ collection: '新建资料集', rename: '重命名资料集', note: '新建文档', edit: '编辑文档', 'delete-doc': '删除文档', 'delete-collection': '删除资料集', import: '导入资料' }[modal.kind]} className={`modal ${['note', 'edit'].includes(modal.kind) ? 'editor' : ''}`}><form onSubmit={e => { e.preventDefault(); void submit() }}><header><h2>{{ collection: '新建资料集', rename: '重命名资料集', note: '新建文档', edit: '编辑文档', 'delete-doc': '删除文档', 'delete-collection': '删除资料集', import: '导入资料' }[modal.kind]}</h2><button type="button" aria-label="关闭对话框" disabled={busy} onClick={() => setModal(null)}><X size={18} /></button></header>
      {modal.kind.startsWith('delete') ? <p>确定删除「{modal.title}」？其中的知识库副本和索引将被删除。</p> : <>
        {['note', 'import'].includes(modal.kind) && <label>保存到资料集<select aria-label="保存到资料集" value={modal.target} onChange={e => setModal({ ...modal, target: e.target.value })}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        {modal.kind !== 'import' && <label>{['note', 'edit'].includes(modal.kind) ? '标题' : '名称'}<input autoFocus required aria-label={['note', 'edit'].includes(modal.kind) ? '标题' : '名称'} maxLength={['note', 'edit'].includes(modal.kind) ? 180 : 80} value={modal.title} onChange={e => setModal({ ...modal, title: e.target.value })} /></label>}
        {['note', 'edit'].includes(modal.kind) && <label className="body-label">正文 · Markdown<textarea aria-label="正文" value={modal.content} onChange={e => setModal({ ...modal, content: e.target.value })} /></label>}
        {modal.kind === 'import' && <><p>导入文件副本，目录中的文件会按层级保留。支持 PDF、Office、Markdown 和文本，每个文件最多 50 MB。</p><ul className="paths">{modal.paths?.map(p => <li key={p}>{p}</li>)}</ul></>}
      </>}
      {modalError && <p role="alert" className="error modal-error">{modalError}</p>}<footer><button type="button" disabled={busy} onClick={() => setModal(null)}>取消</button><button disabled={busy} className={modal.kind.startsWith('delete') ? 'destructive' : 'primary'} type="submit">{busy && <LoaderCircle size={15} className="spin" />}{modal.kind.startsWith('delete') ? '确认删除' : modal.kind === 'import' ? '开始导入' : '保存'}</button></footer>
    </form></section></div>}
  </main>
}
