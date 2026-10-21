import { useState } from 'react'
import { AppShell, Artifacts, TaskDetails, TaskHistory, useEngineApp } from '@moss/engine-apps/ui'

const reader = (file: string) => {
  const escaped = Array.from(file, char => {
    if (char === '*') return '[*]'
    if (char === '?') return '[?]'
    if (char === '[') return '[[]'
    if (char === ']') return '[]]'
    return char
  }).join('').replaceAll("'", "''")
  const fn = /\.parquet$/i.test(file) ? 'read_parquet' : /\.(json|jsonl|ndjson)$/i.test(file) ? 'read_json_auto' : 'read_csv_auto'
  return "SELECT * FROM " + fn + "('" + escaped + "') LIMIT 200"
}
export default function App() {
  const state = useEngineApp()
  const [file, setFile] = useState('')
  const [sql, setSql] = useState('')
  const [format, setFormat] = useState('csv')
  const [outputName, setOutputName] = useState('结果.csv')
  const [sharedSources, setSharedSources] = useState<Array<{ id: string; name: string; format: string }>>([])
  const pick = async () => {
    const result = await state.invoke('paths.pick', { kind: 'file', multiple: false })
    if (result?.paths?.[0]) { setFile(result.paths[0]); setSql(reader(result.paths[0])) }
  }
  const share = async () => {
    const result = await state.invoke('dataset.sources.add', { path: file })
    if (result?.source) { state.setNotice(`已添加可供其他 App 使用的数据源：${result.source.name}`); await refreshShared() }
  }
  const refreshShared = async () => {
    const result = await state.invoke('dataset.sources.list', {})
    if (result?.sources) setSharedSources(result.sources)
  }
  const removeShared = async (sourceId: string) => {
    const result = await state.invoke('dataset.sources.remove', { sourceId })
    if (result?.removed) { state.setNotice('已取消共享数据源'); await refreshShared() }
  }
  const restore = (input: any) => {
    setFile(input.path || ''); setSql(input.sql || ''); setFormat(input.format || 'csv'); setOutputName(input.outputName || '结果.csv')
  }
  const rows: Record<string, unknown>[] = state.task?.result?.rows || []
  const columns = rows[0] ? Object.keys(rows[0]) : []
  return <AppShell state={state} title="本地数据工作台"><div className="two-column">
    <section className="card">
      <div className="section-heading"><h2>数据文件</h2><button onClick={() => void pick()}>选择文件</button></div>
      <input aria-label="数据文件路径" value={file} onChange={event => setFile(event.target.value)} placeholder="CSV、JSON 或 Parquet 文件" style={{ width: '100%' }} />
      <div className="compact-actions"><button disabled={!file} onClick={() => void state.start({ mode: 'preview', path: file, limit: 200 })}>预览前 200 行</button><button disabled={!file} onClick={() => setSql(reader(file))}>生成读取 SQL</button><button disabled={!file || state.busy} onClick={() => void share()}>添加为共享数据源</button></div>
      <details className="advanced" onToggle={event => { if (event.currentTarget.open) void refreshShared() }}><summary>已共享数据源</summary>
        {sharedSources.length ? sharedSources.map(source => <div className="compact-actions" key={source.id}><span>{source.name}</span><button onClick={() => void removeShared(source.id)}>取消共享</button></div>) : <p className="workspace-note">尚未添加共享数据源。</p>}
      </details>
      <div className="advanced"><div className="section-heading"><h2>SQL 查询</h2></div>
        <textarea aria-label="SQL 查询" rows={8} spellCheck={false} value={sql} onChange={event => setSql(event.target.value)} placeholder="SELECT * FROM read_csv_auto('/绝对路径/数据.csv') LIMIT 200" style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', minHeight: 160 }} />
        <div className="workspace-note">可使用完整 DuckDB SQL。页面展示最多 5000 行；大结果建议直接导出。</div>
        <button className="primary run" disabled={!sql.trim() || state.busy} onClick={() => void state.start({ mode: 'query', sql })}>运行查询</button>
      </div>
      <details className="advanced"><summary>导出查询结果</summary><div className="inline-fields">
        <label className="field"><span>格式</span><select aria-label="导出格式" value={format} onChange={event => { setFormat(event.target.value); setOutputName('结果.' + event.target.value) }}><option value="csv">CSV</option><option value="json">JSON</option><option value="parquet">Parquet</option></select></label>
        <label className="field"><span>文件名</span><input aria-label="导出文件名" value={outputName} onChange={event => setOutputName(event.target.value)} /></label>
      </div><button className="primary run" disabled={!sql.trim() || state.busy} onClick={() => void state.start({ mode: 'export', sql, format, outputName })}>导出文件</button></details>
    </section>
    <div className="workspace-body"><TaskDetails state={state}>
      {columns.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column} title={String(row[column] ?? '')}>{row[column] == null ? '' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>}
      {state.task?.result?.rowCount != null && <p className="workspace-note">返回 {state.task.result.rowCount} 行</p>}
      {state.task?.input.mode === 'export' ? <Artifacts state={state} /> : <details className="advanced"><summary>原始结果与导出</summary><Artifacts state={state} /></details>}
    </TaskDetails><TaskHistory state={state} onRestore={restore} /></div>
  </div></AppShell>
}
