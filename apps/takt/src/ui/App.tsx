import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Plus, Play, Square, GitBranch, History, ArrowLeft, Code2, Save, RefreshCw, X, Download, CheckCircle2, Workflow, LoaderCircle } from 'lucide-react'
import Graph from './Graph'
import { client, request } from './api'
import { ConversationButton, ImportButton, FlowTools, RunTools, DiscussButton, RunInConversation } from './WorkspaceTools'
const labels: Record<string, string> = { submitting: '提交中', running: '运行中', pausing: '正在暂停', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const preview = (value: any) => typeof value === 'string' ? value : value?.preview ?? ''
const canonicalRoute = (hash: string) => {
  if (hash.split('?')[0] !== '#/conversation') return hash || '#/'
  const target = new URLSearchParams(hash.split('?')[1]).get('target')
  return target && /^#\/[a-zA-Z0-9/_?=&.%+-]*$/.test(target) ? target : '#/'
}
const go = (route: string) => { location.hash = location.hash.startsWith('#/conversation') ? '/conversation?target=' + encodeURIComponent('#' + route) : route }

export default function App() {
  const [locationRoute, setLocationRoute] = useState(location.hash || '#/'), [flows, setFlows] = useState<any[]>([]), [runs, setRuns] = useState<any[]>([])
  const route = canonicalRoute(locationRoute), workbench = locationRoute.split('?')[0] === '#/conversation'
  const [flow, setFlow] = useState<any>(null), [run, setRun] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState(false), [yaml, setYaml] = useState(''), [title, setTitle] = useState(''), [task, setTask] = useState(''), [runDialog, setRunDialog] = useState(false), [selected, setSelected] = useState(''), [occurrenceId, setOccurrenceId] = useState(''), [expanded, setExpanded] = useState<Record<string, string>>({})
  const [editTarget, setEditTarget] = useState<any>(null)
  const generation = useRef(0)
  const [query, setQuery] = useState(''), [includeArchived, setIncludeArchived] = useState(false), [offset, setOffset] = useState(0), [total, setTotal] = useState(0)
  const refresh = useCallback(async () => {
    const currentGeneration = ++generation.current
    const [catalog, history] = workbench ? [{ items: [], total: 0 }, { items: [], total: 0 }] : await Promise.all([request('takt_read', { operation: 'list', limit: 20, offset, includeArchived, ...(query ? { query } : {}) }), request('takt_read', { operation: 'runs', limit: 20, offset, ...(query ? { query } : {}) })])
    if (currentGeneration !== generation.current) return
    setFlows(catalog.items); setRuns(history.items)
    setTotal(route === '#/history' ? history.total : catalog.total)
    const [kind, id] = route.split('?')[0].replace(/^#\//, '').split('/')
    const revision = new URLSearchParams(route.split('?')[1]).get('revision')
    if (kind === 'flows' && id) { const value = await request('takt_read', { operation: 'get', workflowId: id, ...(revision ? { revision: Number(revision) } : {}) }); if (currentGeneration !== generation.current) return; setFlow(value); setRun(null) }
    else if (kind === 'runs' && id) { const value = await request('takt_read', { operation: 'run', runId: id }); if (currentGeneration !== generation.current) return; setRun(value); setFlow(null) }
    else { setFlow(null); setRun(null) }
  }, [route, query, includeArchived, offset, workbench])
  useEffect(() => { const listener = () => { setLocationRoute(location.hash || '#/'); setFlow(null); setRun(null); setSelected(''); setOccurrenceId(''); setEditor(false); setError('') }; window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }, [])
  useEffect(() => {
    let stopped = false, running = false, timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => { if (running || stopped) return; running = true; try { await refresh() } catch (e: any) { if (!stopped) setError(e.message) } finally { running = false } }
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
    void load(); const off = client?.events.on('takt.changed', changed); const interval = setInterval(load, 5000)
    return () => { stopped = true; generation.current++; off?.(); clearInterval(interval); clearTimeout(timer) }
  }, [refresh])
  const perform = async (action: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await action() } catch (e: any) { setError(e.message) } finally { setBusy(false) } }
  const create = () => perform(async () => {
    if (!client?.composer) throw new Error('Moss 会话入口尚未就绪')
    await client.composer.prepare({ providerId: 'takt-workflows', intent: 'create' })
  })
  const save = () => perform(async () => {
    const result = await request(editTarget ? 'takt_edit' : 'takt_create', { yaml, title, ...(editTarget ? { workflowId: editTarget.id, baseRevision: editTarget.revision } : {}) })
    setEditor(false); go('/flows/' + result.id); await refresh()
  })
  const start = () => perform(async () => {
    const result = await request('takt_run', { workflowId: flow.id, revision: flow.revision, task, submissionKey: crypto.randomUUID() })
    setRunDialog(false); go('/runs/' + result.id)
  })
  const current = run ?? flow
  const selectedNode = current?.graph.nodes.find((n: any) => n.id === selected)
  const occurrences = run?.occurrences.filter((n: any) => n.nodeId === (selectedNode?.logicalId ?? selected)) ?? []
  const occurrence = occurrences.find((n: any) => n.id === occurrenceId) ?? occurrences.at(-1)
  const showFull = (value: any) => perform(async () => {
    let offset = 0, text = ''
    do { const result = await request('takt_read', { operation: 'resource', resourceRef: value.resourceRef, offset, limit: 40000 }); text += result.text; offset = result.nextOffset } while (offset !== null)
    setExpanded(old => ({ ...old, [value.resourceRef]: text }))
  })
  const textBlock = (value: any) => <><pre>{expanded[value?.resourceRef] ?? preview(value)}</pre>{value?.resourceRef && !expanded[value.resourceRef] && <button className="text-button" disabled={busy} onClick={() => showFull(value)}>读取完整内容（{value.length} 字符）</button>}</>
  const exportYaml = () => { const url = URL.createObjectURL(new Blob([current.yaml], { type: 'text/yaml' })); const a = document.createElement('a'); a.href = url; a.download = `${current.name ?? current.id}.yaml`; a.click(); URL.revokeObjectURL(url) }
  const history = route === '#/history'
  const metadata = current && <div className="run-strip">{run ? <><span className={`badge ${run.status}`}>{run.status === 'running' && <LoaderCircle size={12} className="spin"/>}{labels[run.status]}</span><span>修订 {run.revision}</span><span>{run.completedSteps} 次节点完成</span><span>{run.tokens.toLocaleString()} tokens</span><span>{run.toolCalls} 次工具调用</span><span>{date(run.createdAt)}</span></> : <><span className="badge"><CheckCircle2 size={13}/>已校验</span><span>修订 {flow.revision}</span><span>{flow.graph.nodes.filter((n: any) => ['agent','parallel'].includes(n.kind)).length} 个节点</span><span>TAKT 0.70.0</span></>}</div>
  return <div className={`app-shell ${workbench ? 'conversation-view' : ''}`}>
    {!workbench && <aside className="sidebar" aria-label="工作流导航">
      <button className={!history ? 'nav active' : 'nav'} onClick={() => go('/')}><Workflow size={17}/>工作流库<span>{flows.length}</span></button>
      <button className={history ? 'nav active' : 'nav'} onClick={() => go('/history')}><History size={17}/>运行历史<span>{runs.length}</span></button>
      <div className="sidebar-heading">我的工作流<button aria-label="新建工作流" onClick={create}><Plus size={16}/></button></div>
      <div className="flow-list">{flows.map(f => <button key={f.id} className={`flow-list-item ${flow?.id === f.id ? 'selected' : ''}`} onClick={() => go('/flows/' + f.id)}><GitBranch size={15}/><span>{f.title}</span><small>r{f.revision}</small></button>)}</div>
      <footer><i/>本地运行 · 由 Moss 执行<div>模型、工具与权限跟随来源会话</div></footer>
    </aside>}
    <main>
      {error && <div className="error" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError('')}><X size={16}/></button></div>}
      <header className={current ? 'detail-header' : undefined}><div className="heading">{current && !workbench && <button aria-label="返回列表" onClick={() => go(run ? '/history' : '/')}><ArrowLeft size={18}/></button>}<div><div className="eyebrow">{run ? 'RUN / 执行记录' : flow ? 'WORKFLOW / 工作流' : history ? 'HISTORY / 运行历史' : 'WORKSPACE / 工作流库'}</div><h1>{current?.title ?? (history ? '每一次执行，都有记录' : '让协作按流程发生')}</h1></div></div>
        {metadata}<div className="actions">{flow && <><ConversationButton flow={flow} perform={perform}/>{!workbench && <FlowTools flow={flow} perform={perform} refresh={refresh}/>}</>}{run && <><DiscussButton run={run} perform={perform}/><RunTools run={run} perform={perform} refresh={refresh}/></>} {!current && !history && !workbench && <><ImportButton perform={perform}/></>}{current && !workbench && <button onClick={exportYaml} title="导出 YAML"><Download size={16}/></button>}{flow && (workbench ? <RunInConversation flow={flow} perform={perform}/> : <><button onClick={() => { setEditTarget(flow); setYaml(flow.yaml); setTitle(flow.title); setEditor(true) }}><Code2 size={16}/>编辑</button><button className="primary" disabled={flow.archived} onClick={() => setRunDialog(true)}><Play size={15}/>运行工作流</button></>)}{run && (['running', 'pausing', 'paused'].includes(run.status) ? <button disabled={busy} onClick={() => perform(async () => { await request('takt_control', { operation: 'cancel', runId: run.id }); await refresh() })}><Square size={14}/>停止运行</button> : !workbench && <button disabled={busy} onClick={() => perform(async () => { const result = await request('takt_control', { operation: 'rerun', runId: run.id, submissionKey: crypto.randomUUID() }); go('/runs/' + result.id) })}><RefreshCw size={15}/>重新运行</button>)}{!current && !history && !workbench && <button className="primary" onClick={create}><Plus size={17}/>新建工作流</button>}</div>
      </header>
      {!current && !workbench && <div className="library-toolbar"><input aria-label="搜索工作流或运行" placeholder={history ? '搜索运行…' : '搜索工作流…'} value={query} onChange={e => { setOffset(0); setQuery(e.target.value) }}/>{!history && <label className="inline-check"><input type="checkbox" checked={includeArchived} onChange={e => { setOffset(0); setIncludeArchived(e.target.checked) }}/>显示归档</label>}<span>{total} 条</span><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</button><button disabled={offset + 20 >= total} onClick={() => setOffset(offset + 20)}>下一页</button></div>}
      {flow && flow.revision !== flow.latestRevision && <div className="revision-notice">正在查看历史修订 {flow.revision}，最新为 {flow.latestRevision}。{!workbench && <><button onClick={() => go('/flows/' + flow.id)}>查看最新</button><button onClick={() => perform(async () => { await request('takt_edit', { workflowId: flow.id, baseRevision: flow.latestRevision, yaml: flow.yaml }); go('/flows/' + flow.id) })}>将此内容保存为新修订</button></>}</div>}
      {!current && !history && !workbench && <section className="library"><p className="intro">在 Moss 对话中描述任务，生成工作流；在这里观察每一步如何完成。</p><div className="conversation-hint"><span><GitBranch size={19}/></span><div><strong>从一句话开始</strong><p>选择「TAKT 工作流」App，对 Moss 说：“创建一个分析、双路审查、汇总的工作流。”</p></div></div>
        <div className="section-title"><h2>工作流</h2><span>{flows.length} 个流程</span></div><div className="cards">{flows.map(f => <button className="workflow-card" key={f.id} onClick={() => go('/flows/' + f.id)}><div className="card-top"><div className="card-icon"><GitBranch size={21}/></div><span>修订 {f.revision}</span></div><h3>{f.title}{f.archived && <small> · 已归档</small>}</h3><p>{f.description || '可复用的 Agent 工作流'}</p><div className="card-bottom">{f.name}<span>打开 →</span></div></button>)}<button className="new-card" onClick={create}><Plus size={26}/><strong>从一句话开始</strong><span>在 Moss 会话中描述需求，创建工作流</span></button></div></section>}
      {!current && history && !workbench && <section className="history-list">{runs.length === 0 ? <div className="empty"><History size={32}/><h3>运行记录会出现在这里</h3><p>从工作流详情或 Moss 对话启动一次任务。</p></div> : runs.map(r => <button className="run-row" key={r.id} onClick={() => go('/runs/' + r.id)}><span className={`status-dot ${r.status}`}/><div><strong>{r.title}</strong><p>{r.task}</p></div><span className={`badge ${r.status}`}>{labels[r.status]}</span><span>r{r.revision}</span><time>{date(r.createdAt)}</time><span>→</span></button>)}</section>}
      {workbench && !current && <div className="empty">{error ? '读取失败，请返回聊天后重试。' : '正在读取工作流…'}</div>}
      {current && <>{run?.error && <div className="run-error">{run.error}</div>}
        <div className="canvas-layout"><div className="canvas"><Graph key={current.id} graph={current.graph} run={run} selectedId={selected} onSelect={(id: string) => { setSelected(id); setOccurrenceId('') }}/><div className="canvas-caption">{run ? '实际执行状态 · 点击节点查看结果' : '流程预览 · 点击节点查看指令'}</div></div>
          {selectedNode ? <aside className="inspector"><div className="inspector-title"><div><small>节点详情</small><h3>{selectedNode.title}</h3></div><button aria-label="关闭节点详情" onClick={() => setSelected('')}><X size={17}/></button></div><code>{selected}</code><div className="node-discuss"><DiscussButton flow={flow} run={run} node={selectedNode} occurrence={occurrence} perform={perform}/></div>{run ? <>{occurrences.length ? <><label>执行次数<select aria-label="执行次数" value={occurrence?.id} onChange={e => setOccurrenceId(e.target.value)}>{occurrences.map((o: any) => <option key={o.id} value={o.id}>第 {o.visit} 次 · {labels[o.status] || o.status}</option>)}</select></label><div className="detail-label">状态</div><span className={`badge ${occurrence.status}`}>{labels[occurrence.status]}</span><div className="detail-label">输出</div>{textBlock(occurrence.content ?? occurrence.error ?? '等待步骤完成…')}<details><summary>本次执行指令</summary>{textBlock(occurrence.instruction)}</details></> : <p className="muted">这个节点尚未执行。</p>}</> : <><div className="detail-label">节点定义</div><pre>{flow.yaml.split('\n').filter((_: string, i: number, lines: string[]) => { const start = lines.findIndex(l => l.trim() === `- name: ${selected.split('/').at(-1)}`); const end = lines.findIndex((l, n) => n > start && l.startsWith('  - name:')); return i >= start && (end < 0 || i < end) }).join('\n')}</pre></>}</aside> : <aside className="overview"><div className="detail-label">{run ? '本次任务' : '流程说明'}</div><p>{run?.task ?? flow.description}</p><div className="detail-label">{run ? '最近活动' : '使用方式'}</div>{run ? run.events.slice(-8).reverse().map((e: any) => <div className="event" key={e.sequence}><span className="event-dot"/><div><strong>{e.nodeId ?? '工作流'}</strong><small>{e.type === 'node.complete' ? '节点完成' : e.type === 'node.start' ? '开始执行' : e.type === 'phase.start' ? '进入' + (e.phaseName === 'judge' ? '判断阶段' : '执行阶段') : e.type === 'route' ? '转向 ' + (e.target ?? '下一步') : '阶段完成'}</small></div><time>{new Date(e.timestamp).toLocaleTimeString('zh-CN')}</time></div>) : <p className="muted">在 Moss 对话中选择本 App，然后说“运行 {flow.title}”，并描述具体任务。也可以点击上方运行按钮。</p>}</aside>}
        </div></>}
    </main>
    {editor && <div className="modal-backdrop"><section className="modal editor" role="dialog" aria-label="编辑工作流">{error && <div className="run-error">{error}</div>}<div className="modal-header"><h2>{editTarget ? '编辑工作流' : '新建工作流'}</h2><button aria-label="关闭编辑器" onClick={() => setEditor(false)}><X size={19}/></button></div>{notice && <p className="validation-notice" role="status">{notice}</p>}<label>名称<input aria-label="工作流名称" value={title} onChange={e => setTitle(e.target.value)} maxLength={120}/></label><label>TAKT YAML<textarea aria-label="工作流 YAML" spellCheck={false} value={yaml} onChange={e => setYaml(e.target.value)}/></label><p className="muted">支持内联 Agent、条件转移、有限循环与静态并行。保存时自动校验。</p><div className="modal-actions"><button disabled={busy} onClick={() => perform(async () => { await request('takt_validate', { yaml }); setError(''); setNotice('校验通过'); })}>校验</button><button className="primary" disabled={busy} onClick={save}><Save size={16}/>{busy ? '保存中…' : '保存工作流'}</button></div></section></div>}
    {runDialog && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="运行工作流"><div className="modal-header"><h2>运行 {flow?.title}</h2><button aria-label="关闭运行窗口" onClick={() => setRunDialog(false)}><X size={19}/></button></div><label>这次需要完成什么任务？<textarea aria-label="运行任务" placeholder="例如：为一个本地笔记 App 设计 MVP，给出实施与验证建议。" value={task} onChange={e => setTask(e.target.value)} maxLength={16000}/></label><p className="muted">Moss 会创建一个普通会话执行本次任务，你可以在那里处理工具授权。</p><div className="modal-actions"><button disabled={busy} onClick={() => setRunDialog(false)}>取消</button><button className="primary" disabled={busy || !task.trim()} onClick={start}><Play size={15}/>{busy ? '提交中…' : '开始运行'}</button></div></section></div>}
  </div>
}
