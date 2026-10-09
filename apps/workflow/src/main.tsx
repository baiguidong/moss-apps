import { readJsonRanges } from '@moss/app-sdk/results'
import { createAppClient } from '@moss/app-sdk/ui'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppUiApi } from '@moss/app-sdk'
import { GitFork, MessageSquare, Play, Square, Download, History, Layers, X } from 'lucide-react'
import { WorkflowCanvas } from './ui/workflow-canvas'
import { buildWorkflowGraph } from './engine/graph'
import { syncAppearance } from './ui/appearance'
import './style.css'
declare global { interface Window { mossApp?: AppUiApi } }
async function api(name: string, input: any = {}, signal?: AbortSignal): Promise<any> {
  if (!window.mossApp) throw new Error('请在 Moss 中打开工作流 App')
  const client = createAppClient(window.mossApp)
  const expand = async (value: any): Promise<any> => {
    if (!value?.truncated || !value.resourceRef) return value
    return readJsonRanges((range, options) => client.actions.invoke('resource.read', { resourceRef: value.resourceRef, ...range }, options), { signal })
  }
  try {
  const result: any = await client.actions.invoke(name, input, { signal })
  const value = Array.isArray(result) ? await Promise.all(result.map(expand)) : await expand(result)
  if (name === 'run.get' && value.definition?.truncated) value.definition = await expand(value.definition)
  return value
  } finally { client.dispose() }
}
const labels: Record<string, string> = { draft:'草稿',published:'已发布',archived:'已归档',running:'运行中',completed:'已完成',failed:'失败',cancelled:'已停止',interrupted:'已中断',blocked:'受阻',submitting:'准备中' }
function getRoute() {
  const [pathname, query] = location.hash.slice(1).split('?')
  const parts = (pathname || '/').split('/').filter(Boolean)
  return { compact: parts[0] === 'flow' || new URLSearchParams(query).get('view') === 'compact', kind: parts.at(-2), id: parts.at(-1), revision: Number(new URLSearchParams(query).get('revision')) || undefined }
}
function App() {
  useEffect(syncAppearance, [])
  const [route, setRoute] = useState(getRoute)
  const [tab, setTab] = useState('catalog'), [catalog, setCatalog] = useState<any[]>([]), [runs, setRuns] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(), [run, setRun] = useState<any>(), [node, setNode] = useState<any>()
  const [offset, setOffset] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState('')
  const request = useRef(0)
  const act = async (fn: () => Promise<any>) => { setError(''); setBusy(true); try { return await fn() } catch(e: any) { setError(e.message) } finally { setBusy(false) } }
  const refresh = async () => {
    const generation = ++request.current
    const [entries, history, selected] = await Promise.all([
      route.compact ? [] : api('catalog.list', { offset }),
      route.compact ? [] : api('run.list', { offset }),
      route.kind === 'runs' && route.id ? api('run.get', {runId:route.id})
        : route.kind === 'definitions' && route.id ? api('catalog.get', {workflowId:route.id, ...(route.revision ? {revision:route.revision} : {})}) : null,
    ])
    if (generation !== request.current) return
    setCatalog(entries); setRuns(history)
    setRun(route.kind === 'runs' ? selected : undefined)
    setDetail(route.kind === 'definitions' ? selected : undefined)
  }
  useEffect(() => { const change = () => { setNode(undefined); setRoute(getRoute()) }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  useEffect(() => {
    void act(refresh)
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = window.mossApp?.events.on('workflow.changed', () => { clearTimeout(timer); timer = setTimeout(() => void refresh().catch(e => setError(e.message)), 150) })
    return () => { ++request.current; clearTimeout(timer); unsubscribe?.() }
  }, [route.kind, route.id, route.revision, route.compact, offset])
  // Resynchronise after background throttling or a disconnected view.
  useEffect(() => { const wake = () => { if (!document.hidden) void refresh().catch(e => setError(e.message)) }; document.addEventListener('visibilitychange', wake); return () => document.removeEventListener('visibilitychange', wake) }, [route, offset])
  const open = (kind: string, id: string) => { location.hash = `/${kind}/${encodeURIComponent(id)}` }
  const prepare = (intent: 'create' | 'edit' | 'use') => act(async () => {
    if (!window.mossApp?.composer) throw new Error('请更新 Moss 后使用会话入口')
    await window.mossApp.composer.prepare({providerId:'workflows', intent, ...(detail ? {ref:{workflowId:detail.record.id,revision:intent === 'use' ? detail.record.publishedRevision : detail.record.currentRevision}} : {})})
  })
  const mutate = (operation: string) => act(async () => { await api(`catalog.${operation}`, {workflowId:detail.record.id}); setConfirm(''); if(operation === 'delete') location.hash = '/'; await refresh() })
  const definition = run?.definition || detail?.revision?.definition
  const graph = React.useMemo(() => { try { const value = definition && buildWorkflowGraph(definition); return value?.graph } catch { return undefined } }, [definition])
  const download = () => act(async () => {
    const value = run ? await api('run.export', {runId:run.id}) : detail
    const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)], {type:'application/json'}))
    const link = document.createElement('a'); link.href = url; link.download = `${definition.meta.name}.json`; link.click(); URL.revokeObjectURL(url)
  })
  const snapshot = run?.snapshot || {nodes:[],edges:[]}
  return <div className={`app app-shell ${route.compact ? 'flow-view' : ''}`}><div className="body">
    {!route.compact && <aside>
      <nav><button className={tab==='catalog'?'active':''} onClick={() => {setTab('catalog');setOffset(0)}}><Layers size={17}/>工作流目录</button>
        <button className={tab==='runs'?'active':''} onClick={() => {setTab('runs');setOffset(0)}}><History size={17}/>运行记录</button></nav>
      <button className="create-link" onClick={() => void prepare('create')} disabled={busy}><MessageSquare size={15}/>在会话中创建</button>
      <div className="entries">{(tab==='catalog'?catalog:runs).map(entry => <button key={entry.id} className={`entry ${route.id===entry.id?'selected':''}`} onClick={() => open(tab==='catalog'?'definitions':'runs',entry.id)}>
        <strong>{entry.title}</strong><span><i className={`dot ${entry.status}`}/>{labels[entry.status] || entry.status}{entry.scope ? ` · ${entry.scope==='project'?'项目':'个人'}` : ''}</span>
      </button>)}</div>
      <div className="toolbar"><button disabled={!offset} onClick={() => setOffset(Math.max(0,offset-20))}>上一页</button><button disabled={(tab==='catalog'?catalog:runs).length<20} onClick={() => setOffset(offset+20)}>下一页</button></div>
    </aside>}
    <main>
      {error && <div role="alert" className="error">{error}<button onClick={() => void act(refresh)}>重试</button></div>}
      {confirm && <div className="confirm">{confirm==='delete'?'删除后无法恢复。':'将归档该工作流。'}<button className="danger" onClick={() => void mutate(confirm)}>确认{confirm==='delete'?'删除':'归档'}</button><button onClick={() => setConfirm('')}>取消</button></div>}
      {definition ? <>
        <div className="section-title"><div><h2>{definition.meta.title}</h2>{!route.compact && <p>{definition.meta.description}</p>}</div><span className="badge">{run ? labels[run.status] : '流程预览'}</span></div>
        {detail && !route.compact && <div className="toolbar">
          <button className="primary" disabled={busy || detail.record.status==='archived'} onClick={() => void prepare(detail.record.publishedRevision?'use':'edit')}><Play size={15}/>{detail.record.publishedRevision?'使用工作流':'继续完善'}</button>
          {detail.record.publishedRevision && <button onClick={() => void prepare('edit')}><MessageSquare size={15}/>在会话中修改</button>}
          <details className="manage-menu"><summary>更多操作</summary><div className="toolbar">
            <button onClick={() => void mutate('publish')} disabled={busy || detail.record.status==='archived' || detail.record.publishedRevision===detail.record.currentRevision}>发布当前草稿</button>
            {detail.record.publishedRevision && <button onClick={() => void mutate('unpublish')}>取消发布</button>}
            <button onClick={download}><Download size={14}/>导出</button>
            <button onClick={() => detail.record.status==='archived' ? void mutate('restore') : setConfirm('archive')}>{detail.record.status==='archived'?'恢复':'归档'}</button>
            <button className="danger" onClick={() => setConfirm('delete')}>删除</button>
          </div></details>
        </div>}
        {run && ['running','failed','cancelled','interrupted','blocked'].includes(run.status) && <div className="toolbar run-controls"><span>{labels[run.status]}{run.attempt>1?` · 第 ${run.attempt} 次尝试`:''}</span>
          {run.status==='running' ? <button className="danger" disabled={busy} onClick={() => void act(async()=>{await api('run.cancel',{runId:run.id});await refresh()})}><Square size={14}/>停止运行</button>
            : ['failed','cancelled','interrupted','blocked'].includes(run.status) && <button disabled={busy} onClick={() => void act(async()=>{await api('run.resume',{runId:run.id});await refresh()})}>恢复运行</button>}
        </div>}
        {run?.error && <div className="error">{run.error}</div>}
        {graph && <div className="canvas"><WorkflowCanvas graph={graph} nodeEvents={snapshot.nodes} edgeEvents={snapshot.edges} compact={route.compact} onNodeClick={id => setNode(definition.graph.nodes.find((n:any)=>n.id===id))}/></div>}
        {node && <section className="node-detail"><button title="关闭节点详情" onClick={() => setNode(undefined)}><X size={14}/></button><h3>{node.title}</h3><p>{node.description || node.prompt || ''}</p>
          {run && <p>{labels[snapshot.nodes.find((n:any)=>n.nodeId===node.id)?.state] || '尚未运行'}</p>}
          {snapshot.nodes.find((n:any)=>n.nodeId===node.id)?.error && <p className="error">{snapshot.nodes.find((n:any)=>n.nodeId===node.id).error}</p>}
          {['input','output'].map(field => { const value = snapshot.nodes.find((n:any)=>n.nodeId===node.id)?.[field]; return value === undefined ? null : <details key={field}><summary>{field==='input'?'输入':'输出'}</summary><pre>{typeof value==='string'?value:JSON.stringify(value,null,2)}</pre></details> })}
          <details><summary>节点配置</summary><pre>{JSON.stringify(node,null,2)}</pre></details>
        </section>}
        {run && !route.compact && <details><summary>运行结果与导出</summary><pre>{typeof run.result==='string'?run.result:JSON.stringify(run.result,null,2)}</pre><button onClick={download}>导出运行记录</button></details>}
      </> : <div className="empty"><GitFork size={36}/><h2>{route.compact?'正在加载流程':'从需求开始创建流程'}</h2><p>{route.compact?'':'选择已有工作流，或在普通会话中描述你的需求。'}</p>{!route.compact && <button className="primary" onClick={() => void prepare('create')}><MessageSquare size={15}/>在会话中创建</button>}</div>}
    </main>
  </div></div>
}
createRoot(document.getElementById('root')!).render(<App/> )
