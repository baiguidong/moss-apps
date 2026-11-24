import { useState, type ReactNode } from 'react'
import { CircleAlert, Clock3, FolderOpen, Plus, X } from 'lucide-react'
import { Artifacts, labels, type EngineState, type Task } from '@moss/engine-apps/ui'

export const taskLabels: Record<string, string> = {
  init: '创建备份库',
  backup: '备份文件',
  snapshots: '读取备份快照',
  ls: '查看快照中的文件',
  restore: '恢复文件',
  check: '校验备份库',
  raw: '高级备份任务',
}

export function fileName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value
}

export function formatTime(value: number | string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

export function DirectoryField({ state, label, values, onChange, multiple = false, placeholder = '选择目录或输入绝对路径' }: {
  state: EngineState
  label: string
  values: string[]
  onChange: (value: string[]) => void
  multiple?: boolean
  placeholder?: string
}) {
  const pick = async () => {
    const result = await state.invoke('paths.pick', { kind: 'directory', multiple }, { refreshWorkspace: false })
    if (!result?.paths?.length) return
    onChange(multiple ? [...new Set([...values.filter(Boolean), ...result.paths])] : result.paths.slice(0, 1))
  }
  const rows = values.length ? values : ['']
  return <div className="fm-field">
    <div className="fm-field-head"><span>{label}</span>
      <button type="button" disabled={state.busy} onClick={() => void pick()}>
        <FolderOpen size={16} />选择{multiple ? '目录' : label === '备份库目录' ? '备份库' : '目标目录'}
      </button>
    </div>
    <div className="fm-paths">
      {rows.map((value, index) => <div className="fm-path-row" key={index}>
        <input aria-label={index ? `${label} ${index + 1}` : label} value={value}
          onChange={event => onChange(rows.map((row, at) => at === index ? event.target.value : row))}
          placeholder={placeholder} title={value || undefined} />
        {multiple && (value || rows.length > 1) && <button type="button" className="fm-icon-button"
          aria-label={`移除${label} ${index + 1}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}><X size={16} /></button>}
      </div>)}
    </div>
    {multiple && values.some(Boolean) && <button type="button" className="fm-link" onClick={() => onChange([...values, ''])}>
      <Plus size={15} />添加路径
    </button>}
  </div>
}

export function taskIsActive(task?: Task) {
  return task?.status === 'queued' || task?.status === 'running'
}

export function TaskStatus({ task, state, working }: { task: Task; state: EngineState; working: string }) {
  if (!taskIsActive(task)) return null
  const value = /(\d{1,3})%/.exec(task.message)
  return <div className="fm-progress" role="status">
    <div className="fm-section-head">
      <strong>{task.status === 'queued' ? '已加入队列' : working}</strong>
      <button type="button" disabled={state.busy} onClick={() => void state.invoke('tasks.cancel', { id: task.id })}>取消任务</button>
    </div>
    {task.status === 'running' && <>
      <progress aria-label={working} max={100} {...(value ? { value: Number(value[1]) } : {})} />
      {value && <p>{task.message}</p>}
    </>}
  </div>
}

export function TaskExtras({ state, onReuse }: { state: EngineState; onReuse?: (input: Task['input']) => void }) {
  const [open, setOpen] = useState(false)
  const task = state.task
  if (!task || taskIsActive(task)) return null
  return <details className="fm-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>任务详情与报告</summary>
    {open && <div className="fm-details-body">
      <p>{task.message}</p>
      {state.artifactDetailsError && <p role="alert">{state.artifactDetailsError}</p>}
      {onReuse && state.artifactDetailsReady && <button type="button" onClick={() => onReuse(task.input)}>使用这次设置</button>}
      {task.artifacts.length > 0 && <Artifacts state={state} />}
      {task.log && <details className="fm-details"><summary>运行日志</summary><pre>{task.log}</pre></details>}
      {task.argv && <details className="fm-details"><summary>执行参数</summary><pre>{JSON.stringify(task.argv, null, 2)}</pre></details>}
    </div>}
  </details>
}

export function TaskFailure({ task }: { task: Task }) {
  if (!['failed', 'interrupted', 'canceled', 'partial'].includes(task.status)) return null
  const message: Record<string, string> = {
    failed: '任务失败，可在任务详情查看原因。',
    interrupted: '任务中断，可使用原有设置重试。',
    canceled: '任务已取消。',
    partial: '部分文件未能处理，请查看任务详情。',
  }
  return <p className={`fm-callout ${task.status === 'failed' ? 'fm-callout-error' : ''}`}><CircleAlert size={17} />{message[task.status]}</p>
}

export function History({ state, label, action }: { state: EngineState; label: (task: Task) => string; action?: ReactNode }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? state.tasks : state.tasks.slice(0, 5)
  return <section className="fm-panel fm-history" aria-label="任务记录">
    <div className="fm-section-head"><h2><Clock3 size={17} />任务记录</h2>{action}</div>
    {rows.length ? <ul>{rows.map(task => <li key={task.id}>
      <button type="button" className="fm-history-row" aria-current={state.task?.id === task.id ? 'true' : undefined}
        onClick={() => state.setSelected(task.id)}>
        <span><strong>{label(task)}</strong><small>{formatTime(task.createdAt)}{task.source === 'agent-tool' ? ' · Agent' : ''}</small></span>
        <span className={`fm-status fm-status-${task.status}`}>{labels[task.status] || task.status}</span>
      </button>
    </li>)}</ul> : <p className="fm-muted">完成的任务会显示在这里。</p>}
    {state.tasks.length > 5 && <button type="button" className="fm-link" onClick={() => setShowAll(!showAll)}>
      {showAll ? '收起较早记录' : `查看全部 ${state.tasks.length} 条记录`}
    </button>}
  </section>
}
