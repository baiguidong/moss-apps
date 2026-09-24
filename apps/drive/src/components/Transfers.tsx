import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Info, LoaderCircle, Pause, Play, RefreshCw, X } from 'lucide-react'
import type { DriveState, DriveStore } from '../lib/store'
import { bytes, percent, taskLabel } from '../lib/format'
import { errorMessage } from '../lib/errors'

export function Transfers({ state, store, direction }: { state: DriveState; store: DriveStore; direction: 'upload' | 'download' }) {
  const [limit, setLimit] = useState(40)
  const label = direction === 'upload' ? '上传' : '下载'
  const ordered = state.tasks.filter(task => task.direction === direction).sort((a, b) => Number(['completed', 'cancelled'].includes(a.state)) - Number(['completed', 'cancelled'].includes(b.state)))
  const lifecycle = store.api.demo ? '演示进度仅用于体验，刷新页面后清空。' : '关闭页面后继续传输；退出 Moss 后暂停，下次可继续。'
  return <section className="transfers" aria-labelledby="transfer-title">
    <header className="transfer-header">
      <h2 id="transfer-title">{label}记录 <span className="count">{ordered.length}</span></h2>
      <div className="actions">
        <span className="transfer-help" tabIndex={0} aria-label={lifecycle} title={lifecycle}><Info size={14} /></span>
        <button className="quiet compact" disabled={state.tasksLoading || state.cloud !== 'ready'} onClick={() => void store.loadTasks()}><RefreshCw size={14} className={state.tasksLoading ? 'spin' : ''} />更新记录</button>
      </div>
    </header>
    {state.tasksError && <div className="inline-error task-list-error" role="alert"><span>{state.tasksError}</span><button className="quiet compact" disabled={state.tasksLoading || state.cloud !== 'ready'} onClick={() => void store.loadTasks()}>重试传输列表</button></div>}
    <div className="transfer-list">
      {!ordered.length && <div className="empty-state transfer-empty"><span className="empty-icon">{direction === 'upload' ? <ArrowUp size={30} /> : <ArrowDown size={30} />}</span><h2>{state.tasksLoading ? '正在恢复传输记录…' : `还没有${label}任务`}</h2><p>在全部文件中{direction === 'upload' ? '上传文件' : '选择需要下载的文件'}，可在这里查看进度。</p><button className="quiet bordered" onClick={() => store.setView('files')}>前往全部文件</button></div>}
      {ordered.slice(0, limit).map(task => {
        const done = task.state === 'completed', terminal = done || task.state === 'cancelled'
        const cancelling = task.error === 'CANCEL_PENDING'
        const retryCancel = task.error === 'CANCEL_NOT_CONFIRMED'
        const busy = state.controls.includes(task.id) || state.cloud !== 'ready' || cancelling
        const progress = percent(task)
        return <div className={`transfer-row ${terminal ? 'finished' : ''}`} key={task.id} data-testid="transfer-row">
          <span className="direction" aria-label={task.direction === 'upload' ? '上传' : '下载'} title={task.direction === 'upload' ? '上传' : '下载'}>{task.direction === 'upload' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</span>
          <div className="transfer-content">
            <div className="transfer-heading">
              <span className="truncate" title={task.name}>{task.name}</span>
              {terminal && <span className="task-size">{bytes(done ? task.totalBytes : task.transferredBytes)}</span>}
              <span className={`task-status ${done ? 'success' : ''}`}>{done && <Check size={12} aria-hidden="true" />}{taskLabel(task)}</span>
            </div>
            {!terminal && <>
              <div className="transfer-meta"><span>{bytes(task.transferredBytes)} / {bytes(task.totalBytes)}</span><span>{progress}%</span></div>
              <div className="progress" role="progressbar" aria-label={`${task.name} 传输进度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
            </>}
            {task.error && !terminal && <p className="task-error">{errorMessage(task.error)}</p>}
          </div>
          {!terminal && <div className="transfer-controls">
            {state.controls.includes(task.id) || cancelling ? <span className="control-spinner"><LoaderCircle size={16} className="spin" /></span> : task.state === 'paused'
              ? <button className="icon-button" title={retryCancel ? '重试取消' : '继续'} aria-label={`${retryCancel ? '重试取消' : '继续'} ${task.name}`} disabled={busy} onClick={() => void store.control(task, retryCancel ? 'cancel' : 'resume')}>{retryCancel ? <RefreshCw size={16} /> : <Play size={16} />}</button>
              : <button className="icon-button" title="暂停" aria-label={`暂停 ${task.name}`} disabled={busy} onClick={() => void store.control(task, 'pause')}><Pause size={16} /></button>}
            <button className="icon-button" title="取消传输" aria-label={`取消 ${task.name}`} disabled={busy} onClick={() => void store.control(task, 'cancel')}><X size={16} /></button>
          </div>}
        </div>
      })}
      {ordered.length > limit && <div className="load-more"><button className="quiet compact" onClick={() => setLimit(limit + 40)}>显示更多记录</button></div>}
    </div>
  </section>
}
