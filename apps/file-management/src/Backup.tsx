import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, CheckCircle2, Files, HardDrive, History as HistoryIcon, RotateCcw, Search } from 'lucide-react'
import { size, type EngineState, type Task } from '@moss/engine-apps/ui'
import { DirectoryField, fileName, formatTime, History, taskIsActive, taskLabels, TaskExtras, TaskFailure, TaskStatus } from './workspace'

type Snapshot = { id: string; short_id?: string; time: string; paths?: string[] }
type SnapshotData = { id: string; snapshots: Snapshot[] }
type Entry = { path: string; type?: string; size?: number }

function SnapshotFiles({ entries, truncated }: { entries: Entry[]; truncated: boolean }) {
  const [limit, setLimit] = useState(12)
  const [query, setQuery] = useState('')
  const matching = entries.filter(entry => entry.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="fm-snapshot-files">
    <h3>快照中的文件</h3>
    {entries.length > 0 && <label className="fm-filter"><Search size={16} /><input aria-label="筛选快照文件" placeholder="按文件名或路径筛选"
      value={query} onChange={event => { setQuery(event.target.value); setLimit(12) }} /></label>}
    {matching.length ? <ul className="fm-match-list">{matching.slice(0, limit).map(entry => <li className="fm-match" key={entry.path}>
      <span><strong>{fileName(entry.path)}</strong><small title={entry.path}>{entry.path}</small></span>
      <span className="fm-muted">{entry.type === 'dir' ? '文件夹' : typeof entry.size === 'number' ? size(entry.size) : '文件'}</span>
    </li>)}</ul> : <p className="fm-muted">{query ? '没有符合筛选条件的文件。' : '此快照没有可列出的文件。'}</p>}
    {matching.length > limit && <button type="button" className="fm-link" onClick={() => setLimit(limit + 20)}>显示更多文件</button>}
    {truncated && <p className="fm-muted">筛选范围为前 {entries.length} 项。可在任务详情导出完整清单。</p>}
  </section>
}

function BackupOutcome({ state, mode, onReuse }: { state: EngineState; mode: 'backup' | 'restore'; onReuse: (input: Task['input']) => void }) {
  const task = state.task
  const result = task?.result
  const summary = result?.summary
  const command = task?.input.command
  const messages: Record<string, string> = {
    init: '备份库已创建', backup: '备份完成', snapshots: '备份快照已读取',
    ls: '快照文件已读取', restore: '恢复完成', check: '备份库校验通过',
  }
  const activeLabels: Record<string, string> = {
    init: '正在创建备份库', backup: '正在备份文件', snapshots: '正在读取备份快照',
    ls: '正在读取快照文件', restore: '正在恢复文件', check: '正在校验备份库',
  }
  const entries = Array.isArray(result?.entries) ? result.entries.filter((item: Entry) => typeof item.path === 'string') : []
  return <section className="fm-panel fm-result" aria-label="任务结果">
    <div className="fm-section-head"><h2><Archive size={19} />任务结果</h2>
      {task && <span className="fm-tag">{taskLabels[command] || '备份任务'}</span>}
    </div>
    {!task && <div className="fm-empty"><Archive size={29} /><strong>{mode === 'restore' ? '恢复进度会显示在这里' : '备份进度会显示在这里'}</strong></div>}
    {task && <>
      <TaskStatus task={task} state={state} working={activeLabels[command] || '正在处理'} />
      <TaskFailure task={task} />
      {task.status === 'succeeded' && <div className="fm-result-summary fm-result-summary-success">
        <strong><CheckCircle2 size={19} />{messages[command] || '任务完成'}</strong>
        {task.finishedAt && <span>{formatTime(task.finishedAt)}</span>}
      </div>}
      {!taskIsActive(task) && !state.artifactDetailsReady && !state.artifactDetailsError && <p className="fm-muted">正在读取结果…</p>}
      {state.artifactDetailsError && <div className="fm-callout">
        <span>{state.artifactDetailsError}</span><button type="button" onClick={() => void state.refresh(true)}>重试</button>
      </div>}
      {command === 'backup' && summary && <div className="fm-metrics">
        <div><small>已处理文件</small><strong>{summary.total_files_processed ?? 0}</strong></div>
        <div><small>源数据</small><strong>{size(summary.total_bytes_processed ?? 0)}</strong></div>
        <div><small>本次新增</small><strong>{size(summary.data_added_packed ?? 0)}</strong></div>
      </div>}
      {command === 'restore' && task.status === 'succeeded' && <div className="fm-restore-target">
        {summary && <p>已恢复 {summary.files_restored ?? 0} 项 · {size(summary.bytes_restored ?? 0)}</p>}
        <small>恢复位置</small><strong>{task.input.target}</strong>
      </div>}
      {command === 'ls' && result && <SnapshotFiles key={`files-${task.id}`} entries={entries} truncated={Boolean(result.entriesTruncated)} />}
      <TaskExtras key={`details-${task.id}`} state={state} onReuse={onReuse} />
    </>}
  </section>
}

export default function Backup({ state, historyAction }: { state: EngineState; historyAction: ReactNode }) {
  const [mode, setMode] = useState<'backup' | 'restore'>('backup')
  const [repoDraft, setRepoDraft] = useState<string>()
  const [sourceDraft, setSourceDraft] = useState<string[]>()
  const [target, setTarget] = useState('')
  const [snapshotId, setSnapshotId] = useState('')
  const [manualId, setManualId] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [password, setPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [instanceId, setInstanceId] = useState('')
  const [snapshotData, setSnapshotData] = useState<SnapshotData>()
  const [snapshotError, setSnapshotError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const previousBackup = state.tasks.find(task => task.input.command === 'backup' && task.input.repo)
  const repo = repoDraft ?? previousBackup?.input.repo ?? state.tasks.find(task => task.input.repo)?.input.repo ?? ''
  const sources = sourceDraft ?? (previousBackup?.input.repo === repo ? previousBackup?.input.paths : undefined) ?? []
  const repoTasks = state.tasks.filter(task => task.input.repo === repo)
  const knownRepo = repoTasks.some(task => task.status === 'succeeded')
  const snapshotsJob = repoTasks.find(task => task.input.command === 'snapshots')
  const snapshotsRecord = repoTasks.find(task => task.input.command === 'snapshots' && task.status === 'succeeded')
  const snapshots = snapshotData && snapshotData.id === snapshotsRecord?.id ? snapshotData.snapshots : []
  const selectedSnapshot = snapshots.find(item => item.id === snapshotId) ?? snapshots[0]
  const snapshot = manualId.trim() || selectedSnapshot?.id || ''
  const ready = Boolean(configured && repo.trim())
  const busy = state.busy || savingPassword

  useEffect(() => {
    if (!window.mossApp) return
    let mounted = true
    void window.mossApp.instances.list().then((items: Array<{ id: string; secretRefs?: { password?: unknown } }>) => {
      if (!mounted || !items[0]) return
      setInstanceId(items[0].id)
      setConfigured(Boolean(items[0].secretRefs?.password))
    }).catch((error: Error) => { if (mounted) state.setError(error.message) })
    return () => { mounted = false }
  }, [state.setError])

  useEffect(() => {
    if (mode !== 'restore' || !snapshotsRecord) return
    let current = true
    const id = snapshotsRecord.id
    setSnapshotError('')
    void state.getTask(id).then(task => {
      if (!current) return
      const items: Snapshot[] = Array.isArray(task.result?.snapshots) ? [...task.result.snapshots] : []
      items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
      setSnapshotData({ id, snapshots: items })
    }).catch((error: Error) => { if (current) setSnapshotError(error.message) })
    return () => { current = false }
  }, [mode, snapshotsRecord?.id, state.getTask])

  const changeRepo = (values: string[]) => {
    setRepoDraft(values[0] || '')
    setSnapshotId('')
    setManualId('')
    setSnapshotError('')
  }
  const savePassword = async () => {
    if (!password || !instanceId || savingPassword) return
    setSavingPassword(true)
    try {
      await window.mossApp!.instances.update(instanceId, { secrets: { password } })
      setConfigured(true)
      setPassword('')
      state.setNotice('备份密码已保存')
    } catch (error) {
      state.setError((error as Error).message)
    } finally {
      setSavingPassword(false)
    }
  }
  const start = (command: string, input: Record<string, unknown> = {}) => state.start({ command, repo, ...input })
  const loadSnapshots = () => {
    if (ready && !taskIsActive(snapshotsJob)) void start('snapshots')
  }
  const switchToRestore = () => {
    setMode('restore')
    const latestBackup = repoTasks.find(task => task.input.command === 'backup' && task.status === 'succeeded')
    if (mode !== 'restore' && (!snapshotsRecord || (latestBackup && latestBackup.createdAt > snapshotsRecord.createdAt))) loadSnapshots()
  }
  const restore = () => {
    dialog.current?.close()
    void start('restore', { snapshot, target, overwrite: overwrite ? 'always' : 'never' })
  }
  const reuse = (input: Task['input']) => {
    changeRepo([input.repo])
    setMode(input.command === 'restore' || input.command === 'ls' ? 'restore' : 'backup')
    if (input.paths?.length) setSourceDraft(input.paths)
    setTarget(input.target || '')
    setManualId(input.snapshot || '')
    setOverwrite(input.overwrite === 'always')
    document.getElementById('backup-repo')?.scrollIntoView({ block: 'start' })
  }
  const passwordInput = <div className="fm-password">
    <label className="fm-field"><span>备份库密码</span>
      <input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
    </label>
    <button type="button" disabled={busy || !password || !instanceId} onClick={() => void savePassword()}>保存密码</button>
  </div>

  return <div className="fm-workspace fm-backup">
    <div className="fm-column">
      <section className="fm-panel" id="backup-repo">
        <div className="fm-section-head"><h2><HardDrive size={19} />备份库</h2>
          {configured && <span className="fm-tag">密码已保存</span>}
        </div>
        <DirectoryField state={state} label="备份库目录" values={repo ? [repo] : []} onChange={changeRepo} placeholder="选择备份存放位置" />
        {!configured && passwordInput}
        {ready && !knownRepo && <div className="fm-repo-create"><small>首次在空目录存放备份时，先创建备份库。</small>
          <button type="button" disabled={busy || taskIsActive(repoTasks.find(task => task.input.command === 'init'))} onClick={() => void start('init')}>创建备份库</button>
        </div>}
        <details className="fm-details">
          <summary>备份库设置</summary>
          <div className="fm-details-body">
            {configured && passwordInput}
            <div className="fm-actions">
              {knownRepo && <button type="button" disabled={busy || !ready} onClick={() => void start('init')}>创建备份库</button>}
              <button type="button" disabled={busy || !ready} onClick={() => void start('check')}>校验备份库</button>
            </div>
          </div>
        </details>
      </section>
      <section className="fm-panel fm-backup-form">
        <div className="fm-segment" aria-label="备份操作">
          <button type="button" aria-pressed={mode === 'backup'} onClick={() => setMode('backup')}><Archive size={16} />备份文件</button>
          <button type="button" aria-pressed={mode === 'restore'} onClick={switchToRestore}><RotateCcw size={16} />恢复文件</button>
        </div>
        {mode === 'backup' ? <>
          <DirectoryField state={state} label="需要备份的目录" values={sources} multiple onChange={setSourceDraft} />
          <button type="button" className="primary fm-main-button" disabled={busy || !ready || !sources.some(Boolean)}
            onClick={() => void start('backup', { paths: sources.filter(Boolean) })}><Archive size={16} />开始备份</button>
        </> : <>
          <div className="fm-field">
            <div className="fm-field-head"><span>选择备份快照</span>
              <button type="button" disabled={busy || !ready || taskIsActive(snapshotsJob)} onClick={loadSnapshots}>
                <HistoryIcon size={16} />{snapshotsRecord ? '刷新快照' : '读取快照'}
              </button>
            </div>
            {snapshots.length > 0 && <fieldset className="fm-snapshot-list" aria-label="选择备份快照">
              {snapshots.map((item, index) => <label className="fm-snapshot-row" key={item.id}>
                <input type="radio" name="restore-snapshot" checked={!manualId && selectedSnapshot?.id === item.id} onChange={() => {
                  setSnapshotId(item.id); setManualId('')
                }} />
                <span><strong>{formatTime(item.time)}</strong><small title={item.paths?.join('\n')}>{item.paths?.map(fileName).join('、') || '快照'}</small></span>
                {index === 0 && <small className="fm-tag">最新</small>}
              </label>)}
            </fieldset>}
            {selectedSnapshot?.paths?.length && !manualId && <small title={selectedSnapshot.paths.join('\n')}>{selectedSnapshot.paths.join(' · ')}</small>}
            {!snapshots.length && <small>{snapshotError || (taskIsActive(snapshotsJob) ? '正在读取快照…' : snapshotsRecord && snapshotData?.id === snapshotsRecord.id ? '此备份库暂无快照。' : '选好备份库后读取可恢复的快照。')}</small>}
            <details className="fm-details fm-id-field" open={manualId ? true : undefined}>
              <summary>输入快照 ID</summary>
              <input aria-label="快照 ID" value={manualId} onChange={event => setManualId(event.target.value)} placeholder="输入指定的快照 ID" />
            </details>
            {snapshot && <button type="button" className="fm-link" disabled={busy || !ready}
              onClick={() => void start('ls', { snapshot })}><Files size={15} />查看快照中的文件</button>}
          </div>
          <DirectoryField state={state} label="恢复目标目录" values={target ? [target] : []} onChange={values => setTarget(values[0] || '')}
            placeholder="选择用于接收文件的目录" />
          <label className="fm-check"><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />覆盖目标目录的同名文件</label>
          <button type="button" className="primary fm-main-button" disabled={busy || !ready || !snapshot || !target.trim()}
            onClick={() => overwrite ? dialog.current?.showModal() : restore()}><RotateCcw size={16} />开始恢复</button>
          <dialog className="fm-dialog" ref={dialog} aria-labelledby="overwrite-title">
            <h2 id="overwrite-title">确认覆盖同名文件</h2><p>恢复位置为 <strong>{target}</strong>。</p>
            <div className="fm-actions">
              <button type="button" onClick={() => dialog.current?.close()}>返回</button>
              <button type="button" className="primary" onClick={restore}>确认恢复</button>
            </div>
          </dialog>
        </>}
      </section>
    </div>
    <div className="fm-column">
      <BackupOutcome state={state} mode={mode} onReuse={reuse} />
      <History state={state} label={task => taskLabels[task.input.command] || '备份任务'} action={historyAction} />
    </div>
  </div>
}
