import React, { useRef, useState } from 'react'
import { Archive, Copy, History, MessageSquare, Pause, Play, Upload, X, List } from 'lucide-react'
import { client, request } from './api'
type Action = (work: () => Promise<void>) => Promise<void>
export function ConversationButton({ flow, perform }: { flow?: any; perform: Action }) {
  return <button onClick={() => perform(async () => {
    if (!client?.composer) throw new Error('Moss 会话入口尚未就绪')
    await client.composer.prepare({ providerId: 'takt-workflows', intent: flow ? 'edit' : 'create', ...(flow ? { ref: { workflowId: flow.id, revision: flow.revision } } : {}) })
  })}><MessageSquare size={15}/>{flow ? '对话修改' : '对话创建'}</button>
}
export function DiscussButton({ flow, run, node, occurrence, perform }: { flow?: any; run?: any; node?: any; occurrence?: any; perform: Action }) {
  return <button onClick={() => perform(async () => {
    if (!client?.composer) throw new Error('Moss 会话入口尚未就绪')
    await client.composer.prepare({ providerId: 'takt-workflows', intent: 'use', ref: {
      workflowId: run?.workflowId ?? flow.id, revision: (run ?? flow).revision,
      ...(run ? { runId: run.id } : {}), ...(node ? { nodeId: node.id } : {}), ...(occurrence ? { occurrenceId: occurrence.id } : {}),
    } })
  })}><MessageSquare size={15}/>{node ? '在会话中讨论此节点' : '讨论本次运行'}</button>
}
export function RunInConversation({ flow, perform }: { flow: any; perform: Action }) {
  return <button className="primary" disabled={flow.archived} onClick={() => perform(async () => {
    if (!client?.composer) throw new Error('Moss 会话入口尚未就绪')
    await client.composer.prepare({ providerId: 'takt-workflows', intent: 'use', ref: { workflowId: flow.id, revision: flow.revision } })
  })}><Play size={15}/>在会话中运行</button>
}
export function ImportButton({ perform }: { perform: Action }) {
  const input = useRef<HTMLInputElement>(null)
  return <><input ref={input} type="file" accept=".yaml,.yml" hidden style={{ display: 'none' }} aria-label="导入 YAML 文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(async () => { if (file.size > 240000) throw new Error('文件过大，最多 80000 字符'); const flow = await request('takt_create', { title: file.name.replace(/\.ya?ml$/i, ''), yaml: await file.text() }); location.hash = '/flows/' + flow.id }) }}/><button onClick={() => input.current?.click()}><Upload size={15}/>导入</button></>
}
export function FlowTools({ flow, perform, refresh }: { flow: any; perform: Action; refresh: () => Promise<void> }) {
  const [versions, setVersions] = useState<any[] | null>(null)
  return <>
    <button title="复制工作流" aria-label="复制工作流" onClick={() => perform(async () => { const copy = await request('takt_copy', { workflowId: flow.id, revision: flow.revision }); location.hash = '/flows/' + copy.id })}><Copy size={15}/></button>
    <button title="修订历史" aria-label="修订历史" onClick={() => perform(async () => setVersions((await request('takt_read', { operation: 'revisions', workflowId: flow.id })).items))}><History size={15}/></button>
    <button title={flow.archived ? '恢复工作流' : '归档工作流'} aria-label={flow.archived ? '恢复工作流' : '归档工作流'} onClick={() => perform(async () => { await request('takt_archive', { workflowId: flow.id, archived: !flow.archived }); location.hash = '/'; await refresh() })}><Archive size={15}/></button>
    {versions && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="修订历史"><div className="modal-header"><h2>修订历史</h2><button aria-label="关闭修订历史" onClick={() => setVersions(null)}><X size={18}/></button></div><p className="muted">每次保存都保留独立修订；已有运行始终使用提交时的版本。</p>{versions.map(v => <div className="version-row" key={v.revision}><strong>修订 {v.revision}</strong><time>{new Date(v.savedAt).toLocaleString('zh-CN')}</time><button onClick={() => { setVersions(null); location.hash = `/flows/${flow.id}?revision=${v.revision}` }}>查看</button></div>)}</section></div>}
  </>
}
export function RunTools({ run, perform, refresh }: { run: any; perform: Action; refresh: () => Promise<void> }) {
  const [input, setInput] = useState<string | null>(null), [events, setEvents] = useState<any[] | null>(null), [cursor, setCursor] = useState(0), [total, setTotal] = useState(0)
  const live = ['running', 'pausing', 'paused'].includes(run.status)
  const readEvents = (after = 0) => perform(async () => { const page = await request('takt_read', { operation: 'events', runId: run.id, afterSequence: after, limit: 50 }); setEvents(old => after ? [...(old ?? []), ...page.events] : page.events); setCursor(page.nextSequence); setTotal(page.total) })
  return <>
    {live && <><button disabled={run.status === 'pausing'} title="暂停后续调用；已经派发的调用会继续完成" onClick={() => perform(async () => { await request('takt_control', { operation: run.status === 'paused' ? 'resume' : 'pause', runId: run.id }); await refresh() })}>{run.status === 'paused' ? <Play size={14}/> : <Pause size={14}/>} {run.status === 'paused' ? '继续' : run.status === 'pausing' ? '正在暂停' : '暂停'}</button><button aria-label="补充要求" title="给后续步骤补充要求" onClick={() => setInput('')}><MessageSquare size={15}/></button></>}
    <button aria-label="完整事件记录" title="完整事件记录" onClick={() => readEvents()}><List size={16}/></button>
    {input !== null && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="补充要求"><div className="modal-header"><h2>补充要求</h2><button aria-label="关闭补充要求" onClick={() => setInput(null)}><X size={18}/></button></div><textarea aria-label="补充内容" value={input} onChange={e => setInput(e.target.value)} maxLength={8000}/><p className="muted">已开始的 Agent 调用继续使用原指令，新要求将提供给后续步骤。暂停状态仍计入任务总时长。</p><div className="modal-actions"><button className="primary" disabled={!input.trim()} onClick={() => perform(async () => { await request('takt_control', { operation: 'input', runId: run.id, text: input }); setInput(null); await refresh() })}>发送补充要求</button></div></section></div>}
    {events && <div className="modal-backdrop"><section className="modal event-modal" role="dialog" aria-label="完整事件记录"><div className="modal-header"><h2>完整事件记录</h2><button aria-label="关闭事件记录" onClick={() => setEvents(null)}><X size={18}/></button></div><p className="muted">已加载 {events.length} / {total} 条；执行图和节点详情来自同一组记录。</p>{events.map(e => <details key={e.sequence}><summary>#{e.sequence} · {e.nodeId || '工作流'} · {e.type} · {new Date(e.timestamp).toLocaleTimeString('zh-CN')}</summary><pre>{JSON.stringify(e, null, 2)}</pre></details>)}{cursor < total && <button onClick={() => readEvents(cursor)}>加载更多</button>}</section></div>}
  </>
}
