import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createAppClient } from '@moss/app-sdk/ui'
import { FolderOpen, Download, LoaderCircle, Check, X, Files, Clock3, RefreshCw } from 'lucide-react'

export type LocalFile = { id: string; name: string; size: number; kind: string; role: string; taskId?: string; url: string; previewUrl?: string; metadata: Record<string, any>; createdAt: number }
export type LocalTask = { id: string; title: string; status: string; progress: number; message: string; outputs: string[]; input: any; createdAt: number }
export type Workspace = { files: LocalFile[]; tasks: LocalTask[]; unavailableFiles?: { id: string; name: string }[] }
declare global { interface Window { mossApp?: any } }
const labels: Record<string, string> = { queued: '等待中', running: '处理中', canceling: '取消中', succeeded: '已完成', failed: '失败', canceled: '已取消', interrupted: '已中断' }
const activeTaskStatuses = new Set(['queued', 'running', 'canceling'])
const INITIAL_RETRY_MS = 10_000
const ACTIVE_POLL_MS = 15_000
const EVENT_REFRESH_MS = 400
export function bytes(size: number) { return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GiB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(1, Math.round(size / 1024))} KiB` }
export function time(seconds: number) { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}` }
export function useWorkspace() {
  const client = useRef<ReturnType<typeof createAppClient> | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>({ files: [], tasks: [] })
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const alive = useRef(true), loading = useRef<Promise<void> | null>(null), pending = useRef(false)
  const refresh = useCallback(async function refreshWorkspace() {
    if (!alive.current || !client.current) return
    if (loading.current) { pending.current = true; await loading.current; return }
    const current = client.current
    const request = (async () => {
      try { const data = await current.actions.invoke('workspace.get', {}) as Workspace; if (alive.current && client.current === current) { setWorkspace(data); setReady(true) } }
      catch (error) { if (alive.current && client.current === current) setError((error as Error).message) }
    })()
    loading.current = request
    try { await request }
    finally {
      loading.current = null
      if (pending.current && alive.current) { pending.current = false; if (!document.hidden) void refreshWorkspace() }
    }
  }, [])
  useEffect(() => {
    alive.current = true
    if (!window.mossApp) { setError('请在 Moss 中打开此 App。'); return }
    client.current = createAppClient(window.mossApp)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const appearance = async () => {
      const info = await window.mossApp.app.getInfo().catch(() => null)
      if (!alive.current) return
      const mode = info?.appearance?.themeMode
      document.documentElement.dataset.theme = mode === 'dark' || mode === 'light' ? mode : media.matches ? 'dark' : 'light'
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme || 'light'
    }
    void appearance(); media.addEventListener('change', appearance)
    const offAppearance = window.mossApp.events.on('appearance', appearance)
    let eventTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (document.hidden || eventTimer) return
      eventTimer = setTimeout(() => { eventTimer = null; void refresh() }, EVENT_REFRESH_MS)
    }
    const onVisibility = () => {
      setVisible(!document.hidden)
      if (document.hidden) { if (eventTimer) clearTimeout(eventTimer); eventTimer = null }
      else scheduleRefresh()
    }
    const off = client.current.events.on('workspace.changed', scheduleRefresh)
    const offRuntime = client.current.events.on('runtime', value => { const event = value as { type?: string; state?: string }; if (event?.type === 'status' && event.state === 'running') scheduleRefresh() })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', scheduleRefresh)
    if (!document.hidden) void refresh()
    return () => { alive.current = false; pending.current = false; if (eventTimer) clearTimeout(eventTimer); off(); offRuntime(); offAppearance(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', scheduleRefresh); media.removeEventListener('change', appearance); client.current?.dispose(); client.current = null }
  }, [refresh])
  const active = workspace.tasks.some(task => activeTaskStatuses.has(task.status))
  useEffect(() => {
    if (!visible || (ready && !active)) return
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, ready ? ACTIVE_POLL_MS : INITIAL_RETRY_MS)
    return () => clearInterval(timer)
  }, [active, ready, visible, refresh])
  const invoke = useCallback(async (name: string, input: any = {}) => {
    if (!client.current) throw new Error('请在 Moss 中打开此 App。')
    setBusy(true); setError(''); setNotice('')
    try { const result = await client.current.actions.invoke(name, input, { timeoutMs: 300000 }) as any; await refresh(); return result }
    catch (error) { if (alive.current) setError((error as Error).message); return null }
    finally { if (alive.current) setBusy(false) }
  }, [refresh])
  const pick = async () => { const result = await invoke('files.pick'); if (result?.errors.length) setError(result.errors.map((e: any) => `${e.name}：${e.message}`).join('；')); return result }
  const exportFiles = async (ids: string[]) => { const result = await invoke('files.export', { ids }); if (result && !result.canceled) setNotice(`已导出 ${result.files.length} 个文件；同名文件会保留。`) }
  const previewFile = useCallback(async (id: string) => {
    if (!client.current) throw new Error('请在 Moss 中打开此 App。')
    return client.current.actions.invoke('files.preview', { id }) as Promise<{ url: string }>
  }, [])
  return { workspace, error, notice, busy, ready, invoke, pick, exportFiles, previewFile, refresh, setError, setNotice }
}
export type WorkspaceHook = ReturnType<typeof useWorkspace>
export function Shell({ title, children, state, actions }: { title: string; children: ReactNode; state: WorkspaceHook; actions?: ReactNode }) {
  return <div className="task-app"><h1 className="visually-hidden">{title}</h1><header className="app-header" data-app-toolbar aria-label="文件操作"><span className="muted">{state.workspace.files.filter(f => f.role === 'input').length ? `已导入 ${state.workspace.files.filter(f => f.role === 'input').length} 个文件` : '选择本地文件开始'}</span><div className="header-actions">{actions}<button className="primary" disabled={state.busy || !state.ready} onClick={() => void state.pick()}><FolderOpen size={16} />导入文件</button></div></header>
    {state.error && <div role="alert" className="notice error">{state.error}<button aria-label="关闭错误提示" onClick={() => state.setError('')}><X size={16} /></button></div>}
    {!!state.workspace.unavailableFiles?.length && <div role="status" className="notice error">{state.workspace.unavailableFiles.length} 个文件暂时无法访问：{state.workspace.unavailableFiles.slice(0, 3).map(file => file.name).join('、')}{state.workspace.unavailableFiles.length > 3 ? ' 等' : ''}</div>}
    {state.notice && <div role="status" className="notice success"><Check size={16} />{state.notice}</div>}
    <main data-app-primary>{children}</main><footer><span>本地处理 · 结果保存在此 App</span></footer></div>
}
export function Empty({ title, children, onImport }: { title: string; children: ReactNode; onImport: () => void }) { return <div className="empty"><div className="empty-icon"><Files size={36} strokeWidth={1.4} /></div><h2>{title}</h2><p>{children}</p><button className="primary" onClick={onImport}><FolderOpen size={16} />选择本地文件</button></div> }
export function History({ state, onSelect }: { state: WorkspaceHook; onSelect?: (task: LocalTask) => void }) {
  return <section className="history"><div className="section-title"><h2><Clock3 size={16} />任务记录</h2><button aria-label="刷新任务" onClick={() => void state.refresh()}><RefreshCw size={15} /></button></div>
    {!state.workspace.tasks.length && <p className="muted">处理后的文件会保存在这里，重新打开也能继续查看。</p>}
    {state.workspace.tasks.map(task => <article className="task-row" key={task.id}><button className="task-description" onClick={() => onSelect?.(task)}><span>{task.title}</span><small>{task.message}</small></button><span className={`status ${task.status}`}>{labels[task.status]}</span>
      {['running', 'queued', 'canceling'].includes(task.status) && <><progress max="100" value={task.progress} aria-label={task.message} /><button aria-label={`取消${task.title}`} disabled={task.status === 'canceling'} onClick={() => void state.invoke('tasks.cancel', { id: task.id })}><X size={16} /></button></>}
      {task.status === 'succeeded' && <button disabled={state.busy} onClick={() => void state.exportFiles(task.outputs)}><Download size={15} />导出</button>}
      {['failed', 'interrupted', 'canceled'].includes(task.status) && <button disabled={state.busy} onClick={() => void state.invoke('tasks.start', task.input)}>重试</button>}
    </article>)}
  </section>
}
export function Submit({ state, children, disabled, onClick }: { state: WorkspaceHook; children: ReactNode; disabled?: boolean; onClick: () => void }) { return <button className="primary run" disabled={state.busy || disabled} onClick={onClick}>{state.busy && <LoaderCircle size={16} className="spin" />}{children}</button> }
