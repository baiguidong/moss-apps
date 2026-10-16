import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createAppClient } from '@moss/app-sdk/ui'
import { FolderOpen, Download, LoaderCircle, Check, X, Files, Clock3, RefreshCw } from 'lucide-react'

export type LocalFile = { id: string; name: string; size: number; kind: string; role: string; taskId?: string; url: string; previewUrl?: string; metadata: Record<string, any>; createdAt: number }
export type LocalTask = { id: string; title: string; status: string; progress: number; message: string; outputs: string[]; input: any; createdAt: number }
export type Workspace = { files: LocalFile[]; tasks: LocalTask[] }
declare global { interface Window { mossApp?: any } }
const labels: Record<string, string> = { queued: '等待中', running: '处理中', canceling: '取消中', succeeded: '已完成', failed: '失败', canceled: '已取消', interrupted: '已中断' }
export function bytes(size: number) { return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GiB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(1, Math.round(size / 1024))} KiB` }
export function time(seconds: number) { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}` }
export function useWorkspace() {
  const client = useRef<ReturnType<typeof createAppClient> | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>({ files: [], tasks: [] })
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
  const alive = useRef(true), loading = useRef(false)
  const refresh = useCallback(async () => {
    if (!client.current || loading.current) return
    loading.current = true
    try { const data = await client.current.actions.invoke('workspace.get', {}) as Workspace; if (alive.current) { setWorkspace(data); setReady(true) } }
    catch (error) { if (alive.current) setError((error as Error).message) }
    finally { loading.current = false }
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
    const off = client.current.events.on('workspace.changed', () => void refresh())
    void refresh(); const timer = setInterval(refresh, 1200)
    return () => { alive.current = false; clearInterval(timer); off(); offAppearance(); media.removeEventListener('change', appearance); client.current?.dispose() }
  }, [refresh])
  const invoke = useCallback(async (name: string, input: any = {}) => {
    if (!client.current) throw new Error('请在 Moss 中打开此 App。')
    setBusy(true); setError(''); setNotice('')
    try { const result = await client.current.actions.invoke(name, input, { timeoutMs: 300000 }) as any; await refresh(); return result }
    catch (error) { if (alive.current) setError((error as Error).message); return null }
    finally { if (alive.current) setBusy(false) }
  }, [refresh])
  const pick = async () => { const result = await invoke('files.pick'); if (result?.errors.length) setError(result.errors.map((e: any) => `${e.name}：${e.message}`).join('；')); return result }
  const exportFiles = async (ids: string[]) => { const result = await invoke('files.export', { ids }); if (result && !result.canceled) setNotice(`已导出 ${result.files.length} 个文件；同名文件会保留。`) }
  return { workspace, error, notice, busy, ready, invoke, pick, exportFiles, refresh, setError, setNotice }
}
export type WorkspaceHook = ReturnType<typeof useWorkspace>
export function Shell({ title, subtitle, icon, children, state, actions }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode; state: WorkspaceHook; actions?: ReactNode }) {
  return <div className="task-app"><h1 className="visually-hidden">{title}</h1><header className="app-header" aria-label="文件操作"><span className="muted">{state.workspace.files.filter(f => f.role === 'input').length ? `已导入 ${state.workspace.files.filter(f => f.role === 'input').length} 个文件` : '选择本地文件开始'}</span><div className="header-actions">{actions}<button className="primary" disabled={state.busy || !state.ready} onClick={() => void state.pick()}><FolderOpen size={16} />导入文件</button></div></header>
    {state.error && <div role="alert" className="notice error">{state.error}<button aria-label="关闭错误提示" onClick={() => state.setError('')}><X size={16} /></button></div>}
    {state.notice && <div role="status" className="notice success"><Check size={16} />{state.notice}</div>}
    <main>{children}</main><footer><span>本地处理 · 结果保存在此 App</span><span>{state.workspace.files.filter(f => f.role === 'input').length} 个输入 · {state.workspace.tasks.filter(t => t.status === 'succeeded').length} 项已完成</span></footer></div>
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
