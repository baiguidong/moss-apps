import { useState, type FormEvent } from 'react'
import { BarChart3, Plus, RefreshCw, X } from 'lucide-react'
import { request, type Document, type EngineStatus, type Evaluation, type IndexStats } from '../lib/api'
import { useQuery } from '../lib/use-query'

const modes = { incremental: '增量索引', smart: '检测变更并重建关键词索引', resume: '从检查点恢复', full: '全量重新嵌入' }
const operationLabels: Record<string, string> = { incremental: modes.incremental, smart_reindex: '智能重建', nuclear_rebuild: modes.full }
export function IndexTools({ status, revision, refresh, rebuild, busy }: {
  status: EngineStatus; revision: number; refresh: () => void; rebuild: (mode: string) => void; busy: boolean
}) {
  const { data, error } = useQuery<{ stats: IndexStats }>('index.stats', {}, revision)
  const stats = data?.stats, job = status.reindex, last = job?.last_result
  const [mode, setMode] = useState('smart'), [confirmed, setConfirmed] = useState(false)
  return <>
    <header><h1>索引任务</h1><button onClick={refresh}><RefreshCw size={15}/>刷新</button></header>
    {error && <p role="alert" className="banner error">{error}</p>}
    {stats && <div className="metrics">
      <div><span>已索引文档</span><strong>{stats.total_documents}</strong></div><div><span>索引片段</span><strong>{stats.total_chunks}</strong></div>
      <div><span>查询缓存命中率</span><strong>{stats.query_cache.hit_rate}</strong></div>
    </div>}
    <div className="tool-grid"><section className="card"><h2>索引进度</h2>
      {!job ? <p>正在读取任务状态…</p> : job.active ? <>
        <strong>{operationLabels[job.operation || ''] || job.operation} · {job.percent ?? 0}%</strong>
        <progress className="full-progress" value={job.percent || 0} max={100}/>
        <dl><dt>文件进度</dt><dd>{job.progress}</dd><dt>片段进度</dt><dd>{job.chunks_processed ?? 0} / {job.chunks_total ?? 0}</dd>
          <dt>已索引 / 跳过</dt><dd>{job.indexed ?? 0} / {job.skipped ?? 0}</dd><dt>失败</dt><dd>{job.errors ?? 0}</dd>
          {!!job.throughput_cps && <><dt>处理速度</dt><dd>{job.throughput_cps} 片段/秒</dd></>}
          {!!job.eta_seconds && <><dt>预计剩余</dt><dd>{job.eta_seconds} 秒</dd></>}
          {job.checkpoint_saved_at && <><dt>最近检查点</dt><dd>{job.checkpoint_saved_at}</dd></>}
        </dl>
      </> : <><strong>当前空闲</strong>{last ? <dl><dt>上次执行</dt><dd>{[
        ['新增', last.indexed], ['更新', last.updated], ['移除', last.deleted], ['跳过', last.skipped], ['失败', last.errors],
      ].filter(([, value]) => value != null).map(([label, value]) => label + ' ' + value).join(' · ') || '已完成'}</dd></dl> : !job.last_error && <p>本次启动后暂无已完成任务。</p>}</>}
      {job?.last_error && <p role="alert" className="error-text">{job.last_error}</p>}
      <form className="fields" onSubmit={e => { e.preventDefault(); rebuild(mode); setConfirmed(false) }}>
        <label>索引操作<select aria-label="索引操作" value={mode} onChange={e => { setMode(e.target.value); setConfirmed(false) }}>{Object.entries(modes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {mode === 'full' && <label className="check"><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>重新计算所有文档的向量，耗时取决于资料量。</label>}
        <button className="primary" disabled={busy || job?.active || (mode === 'full' && !confirmed)}><RefreshCw size={15}/>执行索引操作</button>
      </form></section>
      {stats && <section className="card"><h2>索引配置</h2><dl>
        <dt>嵌入模型</dt><dd>{stats.embedding_model}</dd><dt>向量维度</dt><dd>{stats.embedding_dim}</dd>
        <dt>分块大小</dt><dd>{stats.chunk_size}</dd><dt>分块重叠</dt><dd>{stats.chunk_overlap}</dd>
        <dt>重排器</dt><dd>{stats.reranker_model === 'disabled' ? '已关闭' : stats.reranker_model}</dd>
        <dt>查询缓存</dt><dd>{stats.query_cache.size} / {stats.query_cache.max_size}</dd>
        <dt>命中 / 未命中</dt><dd>{stats.query_cache.hits} / {stats.query_cache.misses}</dd>
        <dt>缓存时长</dt><dd>{stats.query_cache.ttl_seconds} 秒</dd></dl>
        <details><summary>支持的文件格式</summary><p>{stats.supported_formats.join('、')}</p></details></section>}
    </div>
  </>
}

export function RetrievalEvaluation() {
  const [cases, setCases] = useState([{ query: '', filepath: '' }])
  const [result, setResult] = useState<Evaluation>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const paths = useQuery<{ items: Document[] }>('documents.list', { limit: 100 })
  function update(index: number, field: 'query' | 'filepath', value: string) {
    setResult(undefined); setCases(cases.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }
  async function evaluate(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setResult(undefined)
    try { setResult(await request<Evaluation>('retrieval.evaluate', { cases: cases.map(row => ({ query: row.query.trim(), filepath: row.filepath.trim() })) })) }
    catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  return <>
    <header><div><h1>检索评测</h1><p>用已知答案的问题，检查引擎默认检索的前五条结果是否包含预期文档。</p></div></header>
    <form className="card fields" onSubmit={evaluate}>
      {cases.map((row, i) => <div className="case-row" key={i}>
        <label>测试问题<input required maxLength={1000} value={row.query} disabled={busy} onChange={e => update(i, 'query', e.target.value)}/></label>
        <div className="expected-path">
          <label>预期文档路径<input required placeholder="输入完整的库内路径" value={row.filepath} disabled={busy} onChange={e => update(i, 'filepath', e.target.value)}/></label>
          {!!paths.data?.items.length && <details>
            <summary>选择已索引文档</summary>
            <div>{paths.data.items.map(doc => <button key={doc.filepath} type="button" disabled={busy} onClick={e => {
              e.currentTarget.closest('details')!.open = false
              update(i, 'filepath', doc.filepath)
            }}>{doc.filepath}</button>)}</div>
          </details>}
        </div>
        <button type="button" aria-label={'移除第 ' + (i + 1) + ' 个用例'} disabled={busy || cases.length === 1} onClick={() => { setCases(cases.filter((_, n) => n !== i)); setResult(undefined) }}><X size={15}/></button>
      </div>)}
      <div className="actions"><button type="button" disabled={busy || cases.length >= 50} onClick={() => { setCases([...cases, { query: '', filepath: '' }]); setResult(undefined) }}><Plus size={15}/>添加用例</button><button className="primary" disabled={busy}><BarChart3 size={15}/>{busy ? '正在评测…' : '运行评测'}</button></div>
    </form>
    {error && <p role="alert" className="banner error">{error}</p>}
    {result && <section className="evaluation"><div className="metrics">
      <div><span>测试问题</span><strong>{result.total_queries}</strong></div><div><span>MRR@5</span><strong>{result.mrr_at_5.toFixed(3)}</strong></div>
      <div><span>Recall@5</span><strong>{Math.round(result.recall_at_5 * 100)}%</strong></div></div>
      {result.per_query.map((row,i) => <article className="card case-result" key={i}><div><strong>{row.query}</strong><span>{row.found_at_rank ? '第 ' + row.found_at_rank + ' 名命中' : '前五条未命中'}</span></div><p>预期文档 · {row.expected}<br/>首条结果 · {row.top_result === 'none' ? '无' : row.top_result}</p></article>)}
    </section>}
  </>
}
