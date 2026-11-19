import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, BarChart3, CheckCircle2, ChevronRight, CircleDot, Copy, Database, FileText, Files, LoaderCircle, MessageSquare, Pin, Plus, RefreshCw, Search, Send, Settings2, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { client, request, type Document, type EngineStatus, type Job, type SearchResult, type Settings, type Space } from './lib/api'

type Tab = 'chat' | 'documents' | 'jobs' | 'settings'
const tabLabels: Record<Tab, string> = { chat: 'RAG 对话', documents: '文档', jobs: '索引任务', settings: '检索设置' }
const stateLabels: Record<string, string> = { ready: '已就绪', preparing: '准备中', 'not-ready': '待准备', failed: '需要处理' }

function formatScore(value?: number) { return value === undefined ? '—' : `${Math.round(value * 100)}%` }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error) }

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [spaceId, setSpaceId] = useState('space-default')
  const [documents, setDocuments] = useState<Document[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [results, setResults] = useState<Document[]>([])
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [refusal, setRefusal] = useState('')
  const [selected, setSelected] = useState<Document | null>(null)
  const [busy, setBusy] = useState(false)
  const [autoPrepareAttempted, setAutoPrepareAttempted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [readerOffset, setReaderOffset] = useState(0)
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const activeJobRef = useRef<Job | null>(null)
  const refreshInFlight = useRef<Promise<void> | null>(null)

  const activeSpace = useMemo(() => spaces.find(space => space.id === spaceId) || spaces[0], [spaces, spaceId])
  const activeJob = status?.activeJob || jobs.find(job => job.status === 'running')

  function applyStatus(nextStatus: EngineStatus) {
    activeJobRef.current = nextStatus.activeJob || null
    setStatus(nextStatus)
    setSpaces(nextStatus.spaces || [])
    setSettings(nextStatus.settings)
    if (!spaceId && nextStatus.spaces?.[0]) setSpaceId(nextStatus.spaces[0].id)
  }
  async function refresh() {
    if (refreshInFlight.current) return refreshInFlight.current
    const operation = (async () => {
      try {
        // engine.status already includes spaces, settings, document count and
        // the active/last job. Avoid four queued Actions for every heartbeat.
        const nextStatus = await request<EngineStatus>('engine.status')
        if (mounted.current) applyStatus(nextStatus)
      } catch (cause) { if (mounted.current) setError(errorText(cause)) }
    })()
    refreshInFlight.current = operation
    try { await operation } finally { if (refreshInFlight.current === operation) refreshInFlight.current = null }
  }
  async function loadJobs() {
    try {
      const result = await request<{ jobs: Job[] }>('jobs.list')
      if (mounted.current) setJobs(result.jobs)
    } catch (cause) { if (mounted.current) setError(errorText(cause)) }
  }
  async function loadDocuments() {
    const result = await request<{ items: Document[] }>('documents.list', { spaceId, limit: 100 })
    if (mounted.current) setDocuments(result.items)
  }
  useEffect(() => {
    mounted.current = true
    void refresh()
    const interval = window.setInterval(() => {
      if (!busyRef.current && !activeJobRef.current) void refresh()
    }, 5000)
    const stop = client?.events.on('rag.changed', value => {
      // Backend progress events carry the complete status. Apply them directly
      // so an import never creates a second Action for every progress update.
      const nextStatus = value as EngineStatus
      if (nextStatus?.engine) applyStatus(nextStatus)
    })
    return () => { mounted.current = false; clearInterval(interval); stop?.() }
  }, [])
  useEffect(() => { if (tab === 'jobs') void loadJobs() }, [tab])
  useEffect(() => {
    if (autoPrepareAttempted || status?.state !== 'not-ready' || busy || activeJob) return
    setAutoPrepareAttempted(true)
    void prepare()
  }, [autoPrepareAttempted, status?.state, busy, activeJob])
  useEffect(() => {
    if (spaceId && !busyRef.current && !activeJobRef.current) {
      setLoading(true); void loadDocuments().finally(() => setLoading(false))
    }
  }, [spaceId, activeJob?.status])
  async function run(action: () => Promise<void>) { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice(''); try { await action() } catch (cause) { if (mounted.current) setError(errorText(cause)) } finally { busyRef.current = false; if (mounted.current) setBusy(false) } }
  async function prepare() { await run(async () => { await request('engine.prepare'); await refresh() }) }
  async function retryNative() { await run(async () => { await request('engine.retry'); await refresh(); setNotice('已重新检查 native embedding 环境。') }) }
  async function createSpace() { const name = window.prompt('新知识空间名称'); if (!name?.trim()) return; await run(async () => { const result = await request<{ space: Space }>('spaces.create', { name: name.trim() }); await refresh(); setSpaceId(result.space.id); setNotice(`已创建知识空间：${result.space.name}`) }) }
  async function importFiles() { await run(async () => { const picked = await request<{ paths?: string[] }>('files.pick', { multiple: true }); const paths = picked.paths || []; if (!paths.length) return; const result = await request<{ written: Document[]; failed: { filename: string; error: string }[] }>('files.import', { paths, spaceId }); await refresh(); await loadDocuments(); setTab('documents'); setNotice(`已导入 ${result.written.length} 个文件${result.failed.length ? `，${result.failed.length} 个失败` : ''}`); if (result.failed.length) setError(result.failed.map(item => `${item.filename}：${item.error}`).join('\n')) }) }
  async function cancelJob() {
    if (cancelling || !(activeJobRef.current || activeJob)) return
    setCancelling(true); setError(''); setNotice('')
    try { await request('engine.cancel'); await refresh(); setNotice('已请求取消当前索引任务') }
    catch (cause) { if (mounted.current) setError(errorText(cause)) }
    finally { if (mounted.current) setCancelling(false) }
  }
  async function search() { const text = query.trim(); if (!text) return; await run(async () => { const result = await request<SearchResult>('documents.search', { query: text, spaceId, topK: settings?.topK, threshold: settings?.threshold, hybridAlpha: settings?.hybridAlpha, rerank: settings?.rerank }); setSearched(text); setResults(result.items); setDiagnostics(result.diagnostics); setRefusal(result.refusal || '') }) }
  async function readDocument(doc: Document) { await run(async () => { const result = await request<Document>('documents.read', { id: doc.id, offset: 0, limit: 50000 }); setSelected(result); setReaderOffset(result.nextOffset || 0) }) }
  async function deleteDocument(doc: Document) { await run(async () => { await request('documents.delete', { id: doc.id, revision: doc.revision }); await loadDocuments(); setResults(items => items.filter(item => item.id !== doc.id)); setSelected(null); setNotice(`已删除 ${doc.filename}`) }) }
  async function updateSettings(patch: Partial<Settings>) { if (!settings) return; const next = { ...settings, ...patch }; setSettings(next); await run(async () => { await request('settings.update', patch as Record<string, unknown>); setNotice('检索设置已保存') }) }
  async function readMore() { if (!selected || selected.nextOffset == null) return; await run(async () => { const result = await request<Document>('documents.read', { id: selected.id, offset: selected.nextOffset, limit: 50000 }); setSelected(previous => previous ? { ...previous, content: `${previous.content || ''}${result.content || ''}`, nextOffset: result.nextOffset } : result) }) }
  const ready = status?.state === 'ready'
  const preparing = status?.state === 'preparing' || (!status && !error)
    || (status?.state === 'not-ready' && (!autoPrepareAttempted || busy))

  return <div className="app-shell">
    <aside className="app-sidebar">
      <div className="brand-mark"><div className="brand-icon"><Sparkles size={18} /></div><div><strong>RAG 知识库</strong></div></div>
      <div className="space-switcher"><div className="space-label"><label>知识空间</label><button aria-label="新建知识空间" title="新建知识空间" onClick={() => void createSpace()}><Plus size={14} /></button></div><select value={activeSpace?.id || spaceId} onChange={event => setSpaceId(event.target.value)}>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select><small>{activeSpace?.documentCount || documents.length} 份资料</small></div>
      <nav className="side-nav">{(['chat', 'documents', 'jobs', 'settings'] as Tab[]).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'chat' ? <MessageSquare size={17} /> : item === 'documents' ? <Files size={17} /> : item === 'jobs' ? <BarChart3 size={17} /> : <Settings2 size={17} />}<span>{tabLabels[item]}</span>{item === 'jobs' && activeJob ? <i>{Math.round((activeJob.completed / Math.max(1, activeJob.total)) * 100)}%</i> : <ChevronRight size={15} />}</button>)}</nav>
      <div className="sidebar-status"><span className={`status-dot ${ready ? 'ready' : ''}`} /><strong>{stateLabels[status?.state || 'not-ready'] || status?.state}</strong><small>{status?.engine?.fallback ? '本地回退向量模式' : status?.engine?.model || '等待引擎'}</small></div>
    </aside>
    <main className="workspace">
      <header className="workspace-header"><div><div className="eyebrow">{activeSpace?.name || '知识空间'}</div><h1>{tabLabels[tab]}</h1><p>{tab === 'chat' ? '让问题先经过证据检索，再交给 Moss Agent 生成回答。' : tab === 'documents' ? '管理资料、版本和索引状态。' : tab === 'jobs' ? '查看解析、embedding 和索引任务。' : '控制中文语义和关键词检索策略。'}</p></div><div className="header-actions"><span className={`engine-pill ${ready ? 'online' : ''}`}><CircleDot size={13} />{ready ? '引擎在线' : '引擎未就绪'}</span>{activeJob ? <button disabled={cancelling} onClick={() => void cancelJob()}><X size={16} />{cancelling ? '取消中…' : '取消任务'}</button> : tab !== 'settings' && <button className="primary" disabled={!ready || busy} onClick={() => void importFiles()}><Upload size={16} />导入资料</button>}</div></header>
      {error && <div className="banner error"><AlertCircle size={16} /><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="banner notice"><CheckCircle2 size={16} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {status?.engine?.fallback && <div className="banner warning"><AlertCircle size={16} /><span><strong>Native embedding 不可用，当前使用回退向量。</strong><br />中文语义召回会明显下降。{status.engine.error ? `原因：${status.engine.error}` : ''}</span><button disabled={busy} onClick={() => void retryNative()}>重试 native</button></div>}
      {activeJob && <div role="status" className="job-progress global-job-progress"><LoaderCircle size={16} className="spin" /><div><strong>{activeJob.kind === 'rebuild' ? '正在重建索引' : '正在导入资料'}</strong><span>{activeJob.message || `${activeJob.completed}/${activeJob.total}`}</span></div><progress max={activeJob.total || 1} value={activeJob.completed} /></div>}
      {!ready && <section className="engine-card">
        <div className="engine-card-icon"><Database size={22} /></div>
        <div>
          <h2>{preparing ? '正在准备中文 RAG 引擎' : '引擎未就绪'}</h2>
          <p>{status?.engine?.error || '首次打开会将安装包内置的向量模型复制到 App 缓存，并加载模型。'}</p>
          {status && <div className="engine-meta"><span>模型：{status.engine.model}</span><span>索引：{status.documents} 份资料</span><span>运行：本机 CPU</span></div>}
        </div>
        {preparing ? <LoaderCircle size={16} className="spin" /> : <button className="primary" disabled={busy} onClick={() => void prepare()}><RefreshCw size={16} />重试准备</button>}
      </section>}
      {tab === 'chat' && <ChatView query={query} setQuery={setQuery} searched={searched} results={results} diagnostics={diagnostics} refusal={refusal} busy={busy} ready={ready} onSearch={() => void search()} onRead={doc => void readDocument(doc)} onCopy={text => { void navigator.clipboard?.writeText(text); setNotice('已复制检索证据') }} />}
      {tab === 'documents' && <DocumentsView documents={documents} loading={loading} activeJob={activeJob} onRead={doc => void readDocument(doc)} onDelete={doc => void deleteDocument(doc)} onRefresh={() => void loadDocuments()} />}
      {tab === 'jobs' && <JobsView jobs={jobs} onRefresh={() => void loadJobs()} />}
      {tab === 'settings' && settings && <SettingsView settings={settings} engine={status?.engine} onChange={patch => void updateSettings(patch)} onRebuild={() => void run(async () => { await request('index.rebuild'); await refresh(); setNotice('已提交重建索引') })} busy={busy} />}
    </main>
    {selected && <Reader doc={selected} onClose={() => setSelected(null)} onMore={selected.nextOffset == null ? undefined : () => void readMore()} onDelete={() => void deleteDocument(selected)} />}
  </div>
}

function ChatView({ query, setQuery, searched, results, diagnostics, refusal, busy, ready, onSearch, onRead, onCopy }: { query: string; setQuery: (value: string) => void; searched: string; results: Document[]; diagnostics: Record<string, unknown> | null; refusal: string; busy: boolean; ready: boolean; onSearch: () => void; onRead: (doc: Document) => void; onCopy: (text: string) => void }) {
  return <section className="chat-layout"><div className="chat-main"><div className="welcome"><div className="welcome-icon"><Sparkles size={24} /></div><div><h2>从证据开始回答</h2><p>支持中文自然问法、关键词、代码标识符和多文档线索。检索结果可以直接交给当前 Moss 会话。</p></div></div><form className="query-box" onSubmit={event => { event.preventDefault(); onSearch() }}><textarea value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：客户不想续费时，有哪些处理方案？" maxLength={2000} disabled={!ready} /><div className="query-toolbar"><span><SlidersHorizontal size={14} />语义 + 关键词 · 拒答保护</span><button className="primary" type="submit" disabled={!ready || busy || !query.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}检索证据</button></div></form>{searched && <div className="result-heading"><div><span>检索问题</span><strong>“{searched}”</strong></div><span>{results.length} 个证据片段</span></div>}{refusal && <div className="refusal"><AlertCircle size={17} /><div><strong>没有足够证据</strong><p>{refusal}</p></div></div>}<div className="evidence-list">{results.map((item, index) => <article className="evidence-card" key={`${item.chunkId || item.id}-${index}`}><div className="evidence-rank">{index + 1}</div><div className="evidence-body"><div className="evidence-title"><button onClick={() => onRead(item)}>{item.title || item.filename}</button><span>{formatScore(item.score)}</span></div><p>{item.snippet || item.content}</p><div className="evidence-meta"><span><FileText size={13} />{item.source || item.filename}</span>{item.page && <span>第 {item.page} 页</span>}<span>语义 {formatScore(item.semanticScore)} · 关键词 {formatScore(item.lexicalScore)}</span><button onClick={() => onCopy(item.content || item.snippet || '')}><Copy size={13} />复制</button></div></div></article>)}{searched && !results.length && !refusal && <div className="empty-state"><Search size={30} /><h3>没有命中</h3><p>换一种问法，或检查资料是否已经完成索引。</p></div>}{!searched && <div className="empty-state large"><MessageSquare size={34} /><h3>输入一个问题</h3><p>这里展示最终证据片段、分数和引用。回答生成由 Moss Agent 负责。</p></div>}</div></div><aside className="diagnostics"><div className="panel-title"><span>检索诊断</span><BarChart3 size={15} /></div>{diagnostics ? <dl className="diagnostic-list">{Object.entries(diagnostics).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : <div className="panel-empty"><SlidersHorizontal size={22} /><p>提交问题后查看候选数量、阈值、混合权重和引擎状态。</p></div>}<div className="diagnostic-note"><Pin size={14} /><span>当前结果可通过 Moss 资源引用打开原文。</span></div></aside></section>
}

function DocumentsView({ documents, loading, activeJob, onRead, onDelete, onRefresh }: { documents: Document[]; loading: boolean; activeJob?: Job | null; onRead: (doc: Document) => void; onDelete: (doc: Document) => void; onRefresh: () => void }) {
  return <section className="content-panel"><div className="panel-toolbar"><div><strong>{documents.length} 份资料</strong><span>受管副本不会修改原文件</span></div><button onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button></div>{activeJob && <div className="job-progress"><LoaderCircle size={16} className="spin" /><div><strong>{activeJob.kind === 'rebuild' ? '正在重建索引' : '正在导入资料'}</strong><span>{activeJob.message}</span></div><progress max={activeJob.total || 1} value={activeJob.completed} /></div>}<div className="document-table"><div className="table-head"><span>文档</span><span>状态</span><span>版本</span><span>操作</span></div>{documents.map(doc => <div className="table-row" key={doc.id}><div className="doc-cell"><div className="doc-icon"><FileText size={18} /></div><div><button onClick={() => onRead(doc)}>{doc.filename}</button><small>{doc.sourcePath}</small></div></div><span className={`doc-status ${doc.status === 'ready' ? 'ready' : doc.status === 'error' ? 'error-text' : ''}`}>{doc.status === 'ready' ? '已索引' : doc.status === 'error' ? '失败' : '处理中'}</span><span className="revision">r{doc.revision}</span><div className="row-actions"><button title="读取" onClick={() => onRead(doc)}><ChevronRight size={15} /></button><button title="删除" onClick={() => onDelete(doc)}><Trash2 size={15} /></button></div></div>)}{!documents.length && <div className="empty-state"><Files size={30} /><h3>还没有资料</h3><p>从右上角导入 Markdown、PDF、Office 或代码文件。</p></div>}</div></section>
}

function JobsView({ jobs, onRefresh }: { jobs: Job[]; onRefresh: () => void }) { return <section className="content-panel"><div className="panel-toolbar"><div><strong>索引任务</strong><span>任务状态会保留在 App 私有数据库中</span></div><button onClick={onRefresh}><RefreshCw size={15} />刷新</button></div><div className="jobs-list">{jobs.map(job => <div className="job-row" key={job.id}><div className={`job-icon ${job.status}`}><BarChart3 size={17} /></div><div className="job-main"><strong>{job.kind === 'rebuild' ? '重建索引' : '导入资料'}</strong><span>{job.message || `${job.completed}/${job.total}`}</span>{job.error && <small className="error-text">{job.error}</small>}</div><div className="job-number">{job.total ? `${job.completed}/${job.total}` : '—'}</div><span className={`job-state ${job.status}`}>{job.status === 'done' ? '完成' : job.status === 'failed' ? '失败' : job.status === 'running' ? '进行中' : job.status}</span></div>)}{!jobs.length && <div className="empty-state"><BarChart3 size={30} /><h3>暂无任务</h3><p>导入资料或重建索引后，任务会出现在这里。</p></div>}</div></section> }

function SettingsView({ settings, engine, onChange, onRebuild, busy }: { settings: Settings; engine?: EngineStatus['engine']; onChange: (patch: Partial<Settings>) => void; onRebuild: () => void; busy: boolean }) { return <section className="settings-layout"><div className="settings-main"><section className="setting-card"><div className="setting-heading"><div className="setting-icon"><Sparkles size={18} /></div><div><h2>中文检索策略</h2><p>向量语义和关键词证据共同决定结果排序。</p></div></div><div className="setting-grid"><label><span>语义权重 <b>{Math.round(settings.hybridAlpha * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={settings.hybridAlpha} onChange={event => onChange({ hybridAlpha: Number(event.target.value) })} /><small>越高越偏向自然语言改写；越低越偏向精确词。</small></label><label><span>最低相似度 <b>{settings.threshold.toFixed(2)}</b></span><input type="range" min="0" max="0.8" step="0.01" value={settings.threshold} onChange={event => onChange({ threshold: Number(event.target.value) })} /><small>低于此分数的 chunk 不作为证据返回。</small></label><label><span>返回片段数 <b>{settings.topK}</b></span><input type="range" min="1" max="20" step="1" value={settings.topK} onChange={event => onChange({ topK: Number(event.target.value) })} /><small>最终交给 Agent 或诊断页的证据数量。</small></label></div></section><section className="setting-card"><div className="setting-heading"><div className="setting-icon"><SlidersHorizontal size={18} /></div><div><h2>质量保护</h2><p>控制检索结果是否可以继续进入回答。</p></div></div><div className="toggle-list"><label><input type="checkbox" checked={settings.rerank} onChange={event => onChange({ rerank: event.target.checked })} /><span><strong>启用 rerank</strong><small>对候选片段进行二次排序，中文模型适配将在后续版本加入。</small></span></label><label><input type="checkbox" checked={settings.refusal} onChange={event => onChange({ refusal: event.target.checked })} /><span><strong>无证据时拒答</strong><small>没有达到阈值的证据时，明确返回没有足够资料。</small></span></label></div></section><section className="setting-card"><div className="setting-heading"><div className="setting-icon"><RefreshCw size={18} /></div><div><h2>索引维护</h2><p>embedding 模型或分块策略改变后需要重新索引。</p></div></div><button disabled={busy} onClick={onRebuild}><RefreshCw size={15} />重建全部索引</button></section></div><aside className="engine-detail"><div className="panel-title"><span>引擎状态</span><CircleDot size={15} /></div><dl className="diagnostic-list"><div><dt>模型</dt><dd>{engine?.model || settings.embeddingModel}</dd></div><div><dt>版本</dt><dd>{engine?.revision || '—'}</dd></div><div><dt>维度</dt><dd>{engine?.dimension || '—'}</dd></div><div><dt>来源</dt><dd>{engine?.bundled ? '安装包内置' : '需要网络下载'}</dd></div><div><dt>运行</dt><dd>本机 Node · CPU</dd></div><div><dt>模式</dt><dd>{engine?.fallback ? '回退向量' : 'Native embedding'}</dd></div><div><dt>缓存</dt><dd>{engine?.cacheDir || '—'}</dd></div></dl><div className="diagnostic-note"><Database size={14} /><span>固定模型已随安装包提供；实例缓存位于 App 私有目录。{engine?.sourceUrl ? <><br /><a href={engine.sourceUrl} target="_blank" rel="noreferrer">查看模型仓库与 revision</a></> : null}</span></div></aside></section> }

function Reader({ doc, onClose, onMore, onDelete }: { doc: Document; onClose: () => void; onMore?: () => void; onDelete: () => void }) { return <div className="reader-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="reader"><header><button onClick={onClose}><X size={16} />关闭</button><div className="reader-actions"><button onClick={onDelete}><Trash2 size={15} />删除</button></div></header><div className="reader-heading"><div className="doc-icon large"><FileText size={22} /></div><div><h2>{doc.filename}</h2><p>{doc.sourcePath} · revision {doc.revision}</p></div></div><div className="reader-meta"><span><Pin size={13} />引用资源</span><code>{doc.uri || `moss-rag://resource/${doc.id}?revision=${doc.revision}`}</code></div><pre>{doc.content || '暂无正文'}</pre>{onMore && <button className="reader-more" onClick={onMore}>继续读取</button>}</aside></div> }
