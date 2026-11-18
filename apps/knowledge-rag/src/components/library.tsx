import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, FileText, FolderOpen, Link, Plus, Search, SlidersHorizontal, Upload } from 'lucide-react'
import { request, type Catalog, type Document } from '../lib/api'
import { useQuery } from '../lib/use-query'
import { DocumentForm, Reader } from './document-dialog'

const defaults = { hybridAlpha: 0.7, minScore: 0, limit: 20, method: 'auto', snippet: false, included: '', excluded: '' }
type Filters = typeof defaults
const folders = (text: string) => text.split('\n').map(folder => folder.trim()).filter(Boolean)
const PAGE_SIZE = 50

export function Library({ indexing, onRefresh, onIndexed, revision, onNotice }: {
  indexing: boolean; onRefresh: () => void; onIndexed: () => Promise<void>; revision: number; onNotice: (text: string) => void
}) {
  const catalog = useQuery<Catalog>('documents.categories', {}, revision)
  const categories = catalog.data?.supported || ['general']
  const [category, setCategory] = useState(''), [offset, setOffset] = useState(0)
  const [query, setQuery] = useState(''), [filters, setFilters] = useState(defaults)
  const [search, setSearch] = useState<{ query: string; filters: Filters } | null>(null)
  const [reader, setReader] = useState(''), [form, setForm] = useState<'create' | 'url' | null>(null)
  const [importing, setImporting] = useState(false), [error, setError] = useState('')
  const args = search ? {
    query: search.query, hybridAlpha: search.filters.hybridAlpha, minScore: search.filters.minScore,
    limit: search.filters.limit, method: search.filters.method, snippet: search.filters.snippet,
    includeFolders: folders(search.filters.included), excludeFolders: folders(search.filters.excluded),
  } : { offset, limit: PAGE_SIZE }
  const result = useQuery<{ items: Document[]; total?: number; nextOffset?: number | null; filtered?: number }>(
    search ? 'documents.search' : 'documents.list', { ...args, ...(category && { category }) }, revision)
  const page = result.data
  const busy = importing || indexing
  const canSearchCategory = !catalog.data || !category || categories.includes(category)
  useEffect(() => {
    if (!search && page && offset > 0 && !page.items.length) setOffset(Math.max(0, Math.floor(((page.total || 1) - 1) / PAGE_SIZE) * PAGE_SIZE))
  }, [search, page, offset])
  function saved(message: string) {
    setReader(''); setForm(null); setError(''); onNotice(message); onRefresh()
  }
  async function importFiles() {
    if (busy) return
    setImporting(true); setError('')
    try {
      const picked = await request<{ paths: string[] }>('files.pick')
      if (!picked.paths.length) return
      const { written, failed } = await request<{ written: Document[]; failed: { filename: string; error: string }[] }>('files.import', { paths: picked.paths })
      onNotice(`已复制 ${written.length} 个文件，索引完成后即可搜索。`)
      if (failed.length) setError(failed.map(item => item.filename + '：' + item.error).join('\n'))
      await onIndexed()
    } catch (cause) { setError((cause as Error).message) } finally { setImporting(false) }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); setOffset(0); setError('')
    if (canSearchCategory) setSearch(query.trim() ? { query: query.trim(), filters: { ...filters } } : null)
  }
  return <>
    <header><div><h1>我的资料</h1><p>浏览已入库的文档，或搜索其中的证据片段。</p></div><div className="actions">
      <button disabled={busy} onClick={() => setForm('create')}><Plus size={16}/>新建文档</button>
      <button disabled={busy} onClick={() => setForm('url')}><Link size={16}/>从网页导入</button>
      <button disabled={busy} className="primary" onClick={() => void importFiles()}><Upload size={16}/>{importing ? '正在导入…' : '导入文件'}</button>
    </div></header>
    {(error || catalog.error) && <p className="banner error" role="alert">{error || catalog.error}</p>}
    <form className="search-panel" onSubmit={submit}>
      <div className="search"><Search size={19}/><input aria-label="搜索资料" placeholder="输入问题或关键词" maxLength={1000} value={query} onChange={event => setQuery(event.target.value)}/><button disabled={!canSearchCategory} type="submit">搜索</button></div>
      <div className="filter-bar"><label><FolderOpen size={15}/>分类
        <select aria-label="浏览分类" value={category} onChange={event => {
          const value = event.target.value
          setCategory(value); setOffset(0)
          if (value && !categories.includes(value)) setSearch(null)
        }}>
          <option value="">全部分类</option>{category && catalog.data?.counts?.[category] == null && <option value={category}>{category}</option>}
          {Object.entries(catalog.data?.counts || {}).map(([name, count]) => <option key={name} value={name}>{name} · {count} 份</option>)}
        </select></label>
      </div>
      {!canSearchCategory && <small>引擎支持浏览此分类。选择“全部分类”可检索其中的内容。</small>}
      <details className="search-options"><summary><SlidersHorizontal size={14}/>检索选项</summary><div className="fields option-grid">
        <label>检索方式<select aria-label="检索方式" value={filters.method} onChange={e => setFilters({ ...filters, method: e.target.value })}><option value="auto">自动</option><option value="hybrid">混合检索</option><option value="fts5">全文检索（FTS5）</option></select></label>
        <label>返回片段数<input required type="number" min={1} max={100} value={filters.limit || ''} onChange={e => setFilters({ ...filters, limit: Number(e.target.value) })}/></label>
        <label>语义权重 · {filters.hybridAlpha.toFixed(2)}<input type="range" min="0" max="1" step="0.05" disabled={filters.method === 'fts5'} value={filters.hybridAlpha} onChange={e => setFilters({ ...filters, hybridAlpha: Number(e.target.value) })}/></label>
        <label>最低相关度 · {filters.minScore.toFixed(2)}<input type="range" min="0" max="1" step="0.05" value={filters.minScore} onChange={e => setFilters({ ...filters, minScore: Number(e.target.value) })}/></label>
        <label>仅搜索目录<textarea rows={2} placeholder="每行一个相对目录" value={filters.included} onChange={e => setFilters({ ...filters, included: e.target.value })}/></label>
        <label>排除目录<textarea rows={2} placeholder="每行一个相对目录" value={filters.excluded} onChange={e => setFilters({ ...filters, excluded: e.target.value })}/></label>
        <label className="check"><input type="checkbox" checked={filters.snippet} onChange={e => setFilters({ ...filters, snippet: e.target.checked })}/>返回精简片段</label>
      </div></details>
    </form>
    <div className="list-heading"><strong>{search ? '“' + search.query + '” 的检索结果' : '已入库文档'}{page && (search ? ' · ' + page.items.length + ' 个片段' : ' · ' + page.total + ' 份')}</strong>
      <div className="actions">{search && <button onClick={() => { setSearch(null); setQuery(''); setOffset(0) }}>查看全部</button>}<button onClick={onRefresh}>刷新</button></div></div>
    {result.error && <p role="alert" className="banner error">{result.error}</p>}
    {!page && !result.error && <p role="status">正在读取…</p>}
    {page && !page.items.length && <div className="empty"><FileText size={32}/><h2>{search ? '没有符合条件的片段' : '暂无文档'}</h2><p>{search ? '可更改问题、分类或最低相关度后再搜索。' : '可以导入文件、添加网页或新建文档。'}</p></div>}
    {!!page?.filtered && <p className="muted">{page.filtered} 个候选片段低于最低相关度。</p>}
    <div className="documents">{page?.items.map((item, i) => <article key={item.filepath + ':' + i} className="document-row">
      <button className="document" onClick={() => setReader(item.filepath)}>
        <div className="file-icon"><FileText size={18}/></div><div><strong>{item.filename}</strong><small>{item.filepath} · {item.category || 'general'}{item.chunks != null && ' · ' + item.chunks + ' 个片段'}</small>
          {search && <span className="match-meta">{item.score != null && '相关度 ' + item.score.toFixed(3)}{item.search_method && ' · ' + item.search_method}{item.chunk_index != null && ' · 片段 ' + (item.chunk_index + 1)}</span>}
          {item.content && <p>{item.content}</p>}</div><ChevronRight size={16}/>
      </button>
      {search && item.content && <details className="evidence"><summary>查看命中片段</summary><pre>{item.content}</pre><button onClick={async () => {
        try { await navigator.clipboard.writeText(item.filepath + '\n' + item.content); onNotice('已复制片段和来源。') } catch (cause) { setError((cause as Error).message) }
      }}>复制片段与来源</button></details>}
    </article>)}</div>
    {!search && (offset > 0 || page?.nextOffset != null) && <div className="pagination">
      <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
      <span>第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span><button disabled={page?.nextOffset == null} onClick={() => setOffset(page!.nextOffset!)}>下一页</button></div>}
    {reader && <Reader key={reader} filepath={reader} onClose={() => setReader('')} onOpen={setReader} onSaved={saved} indexing={busy}/>}
    {form && <DocumentForm mode={form} categories={categories} onClose={() => setForm(null)} onSaved={saved}/>}
  </>
}
