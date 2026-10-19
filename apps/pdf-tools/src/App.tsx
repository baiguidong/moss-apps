import { useEffect, useRef, useState } from 'react'
import { FileText, RotateCw, ArrowLeft, ArrowRight, Download, Search, GripVertical } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Shell, Empty, History, Submit, useWorkspace, type LocalFile } from '@moss/local-tasks/ui'
GlobalWorkerOptions.workerSrc = workerUrl
const pdfOptions = { isEvalSupported: false, cMapPacked: true, cMapUrl: new URL('./pdf-assets/cmaps/', document.baseURI).href, standardFontDataUrl: new URL('./pdf-assets/standard_fonts/', document.baseURI).href, wasmUrl: new URL('./pdf-assets/wasm/', document.baseURI).href }
type Page = { key: string; fileId: string; page: number; rotation: number; selected: boolean }
const readableText = (text: string) => text.replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '$1')
const documents = new Map<string, { loading: ReturnType<typeof getDocument>; refs: number; timer?: ReturnType<typeof setTimeout> }>()
function acquireDocument(url: string) {
  let cached = documents.get(url)
  if (!cached) { cached = { loading: getDocument({ url, ...pdfOptions }), refs: 0 }; documents.set(url, cached) }
  clearTimeout(cached.timer); cached.refs++
  const entry = cached
  return { promise: entry.loading.promise, release() { if (--entry.refs === 0) entry.timer = setTimeout(() => { documents.delete(url); void entry.loading.destroy() }, 500) } }
}
function PdfPage({ file, page, rotation = 0, large = false }: { file: LocalFile; page: number; rotation?: number; large?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), [error, setError] = useState('')
  useEffect(() => {
    setError('')
    let disposed = false, render: any
    const loading = acquireDocument(file.url)
    loading.promise.then(async pdf => {
      if (disposed) return
      const p = await pdf.getPage(page + 1), natural = p.getViewport({ scale: 1 }), viewport = p.getViewport({ scale: (large ? 850 : 160) / natural.width, rotation: (p.rotate + rotation) % 360 })
      const target = canvas.current; if (!target || disposed) return
      target.width = viewport.width; target.height = viewport.height
      render = p.render({ canvasContext: target.getContext('2d')!, canvas: target, viewport }); await render.promise
    }).catch(e => { if (!disposed) setError(e.message) })
    return () => { disposed = true; render?.cancel(); loading.release() }
  }, [file.url, page, rotation, large])
  return error ? <p role="alert">预览失败：{error}</p> : <canvas ref={canvas} aria-label={`第 ${page + 1} 页预览`} />
}
export function App() {
  const state = useWorkspace(), inputs = state.workspace.files.filter(f => f.role === 'input')
  const [visible, setVisible] = useState(24), [pages, setPages] = useState<Page[]>([]), [mode, setMode] = useState('arrange'), [language, setLanguage] = useState('chi_sim+eng')
  const [resultId, setResultId] = useState(''), [viewPage, setViewPage] = useState(0), [zoom, setZoom] = useState(100), [query, setQuery] = useState(''), [textPages, setTextPages] = useState<{ page: number; text: string }[]>([]), [searchBusy, setSearchBusy] = useState(false)
  const dragged = useRef<string | null>(null), seen = useRef(new Set<string>())
  useEffect(() => {
    const added = inputs.filter(f => !seen.current.has(f.id)); added.forEach(f => seen.current.add(f.id))
    if (added.length) setPages(old => [...old, ...added.flatMap(f => Array.from({ length: f.metadata.pages }, (_, page) => ({ key: `${f.id}:${page}`, fileId: f.id, page, rotation: 0, selected: true })))])
  }, [inputs.map(f => f.id).join(',')])
  const result = state.workspace.files.find(f => f.id === resultId), selected = pages.filter(p => p.selected)
  const update = (key: string, patch: Partial<Page>) => setPages(pages => pages.map(p => p.key === key ? { ...p, ...patch } : p))
  const move = (key: string, to: number) => setPages(pages => { const copy = [...pages], at = copy.findIndex(p => p.key === key); if (at < 0 || to < 0 || to >= copy.length) return pages; const [page] = copy.splice(at, 1); copy.splice(to, 0, page); return copy })
  async function selectResult(file: LocalFile) {
    setResultId(file.id); setViewPage(0); setTextPages([]); setQuery('')
    const text = state.workspace.files.find(f => f.taskId === file.taskId && f.kind === 'ocr-text')
    if (text) try { setTextPages((await (await fetch(text.url)).json()).pages) } catch { state.setError('识别文字加载失败，请重新打开结果。') }
  }
  async function search() {
    if (!result || textPages.length || !query.trim()) return
    setSearchBusy(true); let pdf: PDFDocumentProxy | undefined
    try { pdf = await getDocument({ url: result.url, ...pdfOptions }).promise; const values = []; for (let i = 1; i <= pdf.numPages; i++) { const text = await (await pdf.getPage(i)).getTextContent(); values.push({ page: i, text: text.items.map((item: any) => item.str || '').join(' ') }) } setTextPages(values) }
    catch (error) { state.setError((error as Error).message) } finally { await pdf?.destroy(); setSearchBusy(false) }
  }
  const searchText = readableText(query.trim())
  const hits = textPages.map(p => ({ ...p, text: readableText(p.text) })).filter(p => !searchText || p.text.toLocaleLowerCase().includes(searchText.toLocaleLowerCase()))
  return <Shell title="PDF 工作台" state={state}>
    {!inputs.length ? <Empty title="把散落的页面整理成一份文档" onImport={() => void state.pick()}>导入 PDF，选择和重排页面，或识别扫描件中的中英文。结果直接在这里翻阅。</Empty> : <>
    <div className="workbench"><section className="panel"><div className="section-title"><h2>{result ? result.name : `页面整理 · ${pages.length} 页`}</h2>{result ? <button onClick={() => setResultId('')}>返回整理</button> : <button onClick={() => setPages(pages.map(p => ({ ...p, selected: selected.length !== pages.length })))}>{selected.length === pages.length ? '取消全选' : '选择全部'}</button>}</div>
      {result ? <><div className="pdf-toolbar"><button aria-label="上一页" disabled={viewPage === 0} onClick={() => setViewPage(p => p - 1)}><ArrowLeft size={16} /></button><span>{viewPage + 1} / {result.metadata.pages}</span><button aria-label="下一页" disabled={viewPage >= result.metadata.pages - 1} onClick={() => setViewPage(p => p + 1)}><ArrowRight size={16} /></button><label>缩放 <select aria-label="PDF 缩放" value={zoom} onChange={e => setZoom(+e.target.value)}>{[50, 75, 100, 125, 150].map(n => <option key={n}>{n}</option>)}</select>%</label><button onClick={() => void state.exportFiles([result.id])}><Download size={15} />导出</button></div><div className="pdf-reader"><div style={{ width: `${zoom}%`, minWidth: `${zoom}%` }}><PdfPage file={result} page={viewPage} large /></div></div></> : <div className="page-grid">{pages.slice(0, visible).map((p, index) => { const f = inputs.find(f => f.id === p.fileId)!; return <article className={`page-tile ${p.selected ? 'checked' : ''}`} key={p.key} draggable onDragStart={() => { dragged.current = p.key }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragged.current) move(dragged.current, index); dragged.current = null }}><label className="page-select"><input aria-label={`选择${f.name}第${p.page + 1}页`} type="checkbox" checked={p.selected} onChange={e => update(p.key, { selected: e.target.checked })} /><span>{index + 1}</span><GripVertical size={14} /></label><PdfPage file={f} page={p.page} rotation={p.rotation} /><small title={f.name}>{f.name} · 第 {p.page + 1} 页</small><div className="page-actions"><button aria-label={`第${index + 1}项前移`} disabled={index === 0} onClick={() => move(p.key, index - 1)}><ArrowLeft size={14} /></button><button aria-label={`旋转第${index + 1}项`} onClick={() => update(p.key, { rotation: (p.rotation + 90) % 360 })}><RotateCw size={14} /></button><button aria-label={`第${index + 1}项后移`} disabled={index === pages.length - 1} onClick={() => move(p.key, index + 1)}><ArrowRight size={14} /></button></div></article> })}{pages.length > visible && <button onClick={() => setVisible(n => n + 24)}>显示更多页面（{pages.length - visible}）</button>}</div>}
    </section><aside className="panel options"><div className="section-title"><h2>{result ? '查找文字' : '处理设置'}</h2></div><div className="panel-body">{result ? <><div className="field"><span>搜索当前结果</span><input aria-label="搜索 PDF 文字" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入关键词" onKeyDown={e => { if (e.key === 'Enter') void search() }} /></div><button onClick={() => void search()} disabled={searchBusy}><Search size={15} />{searchBusy ? '正在提取文字' : '搜索'}</button><div className="search-results">{hits.map(p => <button key={p.page} onClick={() => setViewPage(p.page - 1)}><strong>第 {p.page} 页</strong><span>{p.text.slice(Math.max(0, p.text.toLowerCase().indexOf(searchText.toLowerCase()) - 35), Math.max(0, p.text.toLowerCase().indexOf(searchText.toLowerCase()) - 35) + 180)}</span></button>)}</div>{query && textPages.length > 0 && hits.length === 0 && <small>未找到匹配文字。</small>}</> : <>
      <label className="field"><span>操作</span><select value={mode} onChange={e => setMode(e.target.value)}><option value="arrange">合并 / 按选择顺序生成 PDF</option><option value="split">每页拆分为独立 PDF</option><option value="ocr">OCR 生成可搜索 PDF</option></select></label>
      <p className="muted">已选 {selected.length} 页。拖动页面或使用箭头调整顺序。</p>
      {mode === 'ocr' && <><label className="field"><span>识别语言</span><select value={language} onChange={e => setLanguage(e.target.value)}><option value="chi_sim+eng">简体中文 + 英文</option><option value="chi_sim">简体中文</option><option value="eng">英文</option></select></label><small>每次最多识别 80 页。输出为带文字层的页面图像，原 PDF 保留。</small></>}
      <Submit state={state} disabled={!selected.length} onClick={() => void state.invoke('tasks.start', { fileIds: [...new Set(selected.map(p => p.fileId))], options: { mode, language, pages: selected.map(({ fileId, page, rotation }) => ({ fileId, page, rotation })) } })}>{mode === 'ocr' ? '开始识别' : '生成 PDF'}</Submit>
    </>}</div></aside></div>
    {!!state.workspace.files.some(f => f.role === 'output' && f.kind === 'pdf') && <div className="file-list pdf-results">{state.workspace.files.filter(f => f.role === 'output' && f.kind === 'pdf').map(f => <button key={f.id} className={f.id === resultId ? 'selected' : ''} onClick={() => void selectResult(f)}><FileText size={16} />{f.name}<small>{f.metadata.pages} 页</small></button>)}</div>}
    </>}<History state={state} onSelect={task => { const file = state.workspace.files.find(f => task.outputs.includes(f.id) && f.kind === 'pdf'); if (file) void selectResult(file) }} />
  </Shell>
}
