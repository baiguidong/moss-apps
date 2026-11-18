import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Copy, FileText, Pencil, Search, Trash2, X } from 'lucide-react'
import { request, type Document } from '../lib/api'
import { useQuery } from '../lib/use-query'

export function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="reader" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2>{title}</h2><button aria-label={title === '阅读资料' ? '关闭阅读' : '关闭窗口'} disabled={busy} onClick={onClose}><X size={16}/></button></header>
    {children}
  </dialog>
}

export function DocumentForm({ mode, categories, filepath, initial, onClose, onSaved }: {
  mode: 'create' | 'url' | 'edit'; categories: string[]; filepath?: string; initial?: { content: string; revision: string }
  onClose: () => void; onSaved: (message: string) => void
}) {
  const [category, setCategory] = useState('general'), [name, setName] = useState('')
  const [url, setUrl] = useState(''), [content, setContent] = useState(initial?.content || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const title = mode === 'edit' ? '编辑原文' : mode === 'url' ? '从网页导入' : '新建文档'
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      if (mode === 'edit') await request('documents.update', { filepath, content, revision: initial?.revision })
      if (mode === 'url') await request('documents.from-url', { url: url.trim(), category, ...(name.trim() && { title: name.trim() }) })
      if (mode === 'create') await request('documents.create', { filepath: category + '/' + name.trim(), content, category })
      onSaved(mode === 'edit' ? '已保存原文并更新索引。' : '文档已加入索引。')
    } catch (cause) { setError((cause as Error).message); setBusy(false) }
  }
  return <Dialog title={title} onClose={onClose} busy={busy}><form className="fields" onSubmit={save}>
    {filepath && <p className="source">{filepath}</p>}
    {mode !== 'edit' && <label>分类<select aria-label="分类" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>}
    {mode === 'url' && <label>网页地址<input autoFocus type="url" required placeholder="https://…" value={url} onChange={event => setUrl(event.target.value)}/></label>}
    {mode !== 'edit' && <label>{mode === 'url' ? '标题（可选）' : '文件名或分类内路径'}
      <input required={mode === 'create'} autoFocus={mode === 'create'} placeholder={mode === 'url' ? '默认使用网页标题' : '产品笔记.md'} value={name} maxLength={mode === 'url' ? 256 : 1024} onChange={event => setName(event.target.value)}/>
      {mode === 'url' && <small>同一分类下，生成的文件名相同时会更新已有副本。</small>}
    </label>}
    {mode !== 'url' && <label>正文<textarea aria-label="正文" rows={15} maxLength={120000} required value={content} onChange={event => setContent(event.target.value)}/>
      {content !== content.trim() && <small>引擎保存时会去掉整篇正文首尾的空白字符。</small>}</label>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || (mode !== 'url' && !content.trim())}>{busy ? '正在入库…' : mode === 'url' ? '导入网页' : '保存并索引'}</button></div>
  </form></Dialog>
}

export function Reader({ filepath, onClose, onOpen, onSaved, indexing }: {
  filepath: string; onClose: () => void; onOpen: (path: string) => void; onSaved: (message: string) => void; indexing: boolean
}) {
  const { data, error: readError } = useQuery<Document>('documents.read', { filepath })
  const [extra, setExtra] = useState<Document | null>(null)
  const doc = extra || data
  const [mode, setMode] = useState<'read' | 'similar' | 'remove'>('read')
  const [source, setSource] = useState<{ content: string; revision: string }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  const [deleteFile, setDeleteFile] = useState(false)
  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  if (source) return <DocumentForm mode="edit" categories={[]} filepath={filepath} initial={source} onClose={() => setSource(undefined)} onSaved={onSaved}/>
  return <Dialog title="阅读资料" onClose={onClose} busy={busy}>
    <div className="reader-title"><FileText size={24}/><div><h3>{doc?.filename || filepath.split('/').pop()}</h3><small>{filepath}</small></div></div>
    {readError && <p role="alert" className="error-text">{readError}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {!doc && !readError && <p role="status">正在读取正文…</p>}
      <div className="reader-tools">
        <button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(filepath); setCopied(true) })}><Copy size={15}/>{copied ? '已复制路径' : '复制来源'}</button>
        <button aria-pressed={mode === 'similar'} onClick={() => setMode(mode === 'similar' ? 'read' : 'similar')}><Search size={15}/>相似资料</button>
        {!/\.(pdf|docx|xlsx|pptx)$/i.test(filepath) && <button disabled={busy || indexing} onClick={() => void run(async () => setSource(await request('documents.source', { filepath })))}><Pencil size={15}/>编辑原文</button>}
        <button disabled={busy || indexing} onClick={() => setMode('remove')}><Trash2 size={15}/>移除资料</button>
      </div>
      {mode === 'remove' && <section className="confirm-box fields"><h3>从索引移除这份资料？</h3><label className="check"><input type="checkbox" checked={deleteFile} onChange={event => setDeleteFile(event.target.checked)}/>同时删除知识库中的文件副本</label>
        <small>{deleteFile ? '删除后只能通过重新导入或新建恢复。' : '保留的副本可能在下次重建索引时重新出现。'}</small>
        <div className="actions"><button disabled={busy} onClick={() => setMode('read')}>取消</button><button disabled={busy || indexing} className="danger" onClick={() => void run(async () => {
          const result = await request<{ file_deleted: boolean; file_delete_error?: string }>('documents.remove', { filepath, deleteFile })
          onSaved(result.file_delete_error ? '已移除索引，删除副本失败：' + result.file_delete_error : result.file_deleted ? '已移除索引并删除文件副本。' : '已从索引移除，文件副本已保留。')
        })}>确认移除</button></div></section>}
      {mode === 'similar' && <Similar filepath={filepath} onOpen={onOpen}/>}
      {doc && <pre className="content">{doc.content}</pre>}
      {doc?.nextOffset != null && <button disabled={busy} onClick={() => void run(async () => {
        const page = await request<Document>('documents.read', { filepath, offset: doc.nextOffset })
        setExtra({ ...page, content: (doc.content || '') + page.content })
      })}>继续阅读</button>}
  </Dialog>
}
function Similar({ filepath, onOpen }: { filepath: string; onOpen: (path: string) => void }) {
  const [limit, setLimit] = useState(5)
  const { data, error } = useQuery<{ items: Document[] }>('documents.similar', { filepath, limit })
  return <section className="related"><div className="panel-heading"><h3>相似资料</h3><label>最多 <select aria-label="相似资料数量" value={limit} onChange={event => setLimit(Number(event.target.value))}>{Array.from({ length: 20 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select> 份</label></div>
    {error && <p role="alert">{error}</p>}{!data && !error && <p>正在匹配…</p>}{data && !data.items.length && <p>暂无相似资料。</p>}
    {data?.items.map(item => <button key={item.filepath} onClick={() => onOpen(item.filepath)}><strong>{item.filename}</strong><small>{item.score?.toFixed(3)} · {item.filepath}</small><span>{item.content}</span></button>)}
  </section>
}
