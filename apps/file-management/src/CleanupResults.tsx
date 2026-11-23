import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, File, FileSearch, FolderOpen, HardDrive, Layers3, Search, Trash2, Wrench, X, ZoomIn } from 'lucide-react'
import { size, type EngineState, type Task } from '@moss/engine-apps/ui'
import { fileName, formatTime, TaskExtras, TaskFailure, TaskStatus, taskIsActive } from './workspace'

type Match = {
  path: string; size?: number; modified_date?: number; previewIndex?: number; trashIdentity?: string
  current_extension?: string; proper_extension?: string; new_name?: string
  exif_tags?: unknown[]; symlink_info?: { destination_path?: string }
}
type Group = { files: Match[] }
type TrashReport = { total: number; moved: number; entries: { path: string; status: string; message?: string }[] }
const limit = 500
const grouped = new Set(['dup', 'image', 'music', 'video'])
const trashCommands = new Set(['dup', 'image', 'music', 'video', 'big', 'empty-files', 'empty-folders', 'temp', 'symlinks', 'broken', 'bad-names'])
const fixes: Record<string, { label: string; detail: string }> = {
  ext: { label: '修正扩展名', detail: '按检测到的文件类型修改扩展名。' },
  'bad-names': { label: '修正文件名', detail: '按本次扫描的命名规则修改文件名。' },
  'exif-remover': { label: '生成去除拍摄信息的副本', detail: '在原目录生成清除拍摄信息的图片副本，保留原图。' },
  'video-optimizer': { label: '生成优化视频', detail: '按本次扫描选择的方式生成优化视频，保留原视频。' },
}

function MatchReview({ state, task, title }: { state: EngineState; task: Task; title: string }) {
  const result = task.result
  const groups: Group[] = result.groups || []
  const command = task.input.command
  const byGroup = grouped.has(command)
  const selectable = task.status === 'succeeded' && result.trashSelection === true
  const applied = Boolean(task.input.followUp)
  const fix = !applied && task.status === 'succeeded' && !task.input.confirmChanges && !task.input.extraArgs?.length &&
    !task.input.suboptions?.['custom-ffmpeg-command'] ? fixes[command] : undefined
  const [visible, setVisible] = useState(8)
  const [expanded, setExpanded] = useState(new Set<number>())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'all' | 'selected'>('all')
  const [selected, setSelected] = useState(new Set<string>())
  const [pending, setPending] = useState<'trash' | 'fix'>('trash')
  const [image, setImage] = useState<{ url: string; name: string }>()
  const confirmation = useRef<HTMLDialogElement>(null)
  const preview = useRef<HTMLDialogElement>(null)
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return groups.map((group, index) => ({ index, files: group.files.filter(file =>
      (view === 'all' || selected.has(file.path)) && file.path.toLocaleLowerCase().includes(term)) }))
      .filter(group => group.files.length)
  }, [groups, query, selected, view])
  const matches = filtered.flatMap(group => group.files)
  const displayedGroups = filtered.slice(0, visible)
  const displayed = byGroup ? displayedGroups.flatMap(group => expanded.has(group.index) ? group.files : group.files.slice(0, 4)) : matches.slice(0, visible)
  const picked = [...new Map(groups.flatMap(group => group.files).filter(file => selected.has(file.path)).map(file => [file.path, file])).values()]
  const pickedBytes = picked.reduce((sum, file) => sum + (file.size || 0), 0)
  const visiblePaths = [...new Set(displayed.filter(file => file.trashIdentity).map(file => file.path))]
  const visibleChecked = visiblePaths.length > 0 && visiblePaths.every(value => selected.has(value))
  const canSuggest = selectable && command === 'dup' && !result.truncated && !task.input.extraArgs?.length &&
    !task.input.options?.['reference-directories']?.length && ['HASH', undefined, ''].includes(task.input.options?.['search-method'])
  const suggestions = canSuggest ? groups.flatMap(group => {
    if (group.files.some(file => !file.trashIdentity)) return []
    return [...group.files].sort((a, b) => (b.modified_date || 0) - (a.modified_date || 0) || a.path.localeCompare(b.path)).slice(1).map(file => file.path)
  }) : []

  const update = (paths: string[], checked: boolean) => setSelected(previous => {
    const next = new Set(previous)
    for (const value of paths) {
      if (!checked) next.delete(value)
      else if (next.size < limit) next.add(value)
    }
    return next
  })
  const confirm = (operation: 'trash' | 'fix') => {
    setPending(operation)
    confirmation.current?.showModal()
  }
  const apply = async () => {
    confirmation.current?.close()
    const job = await state.invoke('cleanup.apply', { id: task.id, operation: pending, ...(pending === 'trash' ? { paths: picked.map(file => file.path) } : {}) })
    if (job) state.setSelected(job.id)
  }
  const rescan = async () => {
    const job = await state.invoke('cleanup.start', task.input)
    if (job) state.setSelected(job.id)
  }
  const renderMatch = (file: Match) => {
    const imageUrl = file.previewIndex === undefined ? undefined : task.artifacts[file.previewIndex]?.url
    const name = fileName(file.path)
    const parent = file.path.slice(0, -name.length).split(/[\\/]/).filter(Boolean)
    const location = parent.length > 3 ? `…/${parent.slice(-3).join('/')}` : `/${parent.join('/')}`
    return <li key={file.path} className="fm-review-item" data-selected={selected.has(file.path)}>
      {selectable && <label className="fm-review-checkbox">
        <input type="checkbox" aria-label={`勾选 ${name}`} checked={selected.has(file.path)}
          disabled={!file.trashIdentity || (picked.length >= limit && !selected.has(file.path))}
          onChange={event => update([file.path], event.target.checked)} />
      </label>}
      {imageUrl ? <button type="button" className="fm-review-image" aria-label={`预览 ${name}`} onClick={() => {
        setImage({ url: imageUrl, name }); preview.current?.showModal()
      }}><img src={imageUrl} alt="" loading="lazy" /><ZoomIn size={15} /></button> :
        <span className="fm-review-file-icon">{command === 'empty-folders' ? <FolderOpen size={19} /> : <File size={19} />}</span>}
      <div className="fm-review-description"><strong>{name}</strong><small title={file.path}>{location}</small>
        {file.proper_extension && <small className="fm-extension-hint">扩展名 · .{file.current_extension} → .{file.proper_extension}</small>}
        {file.new_name && <small className="fm-extension-hint">建议名称 · {file.new_name}</small>}
        {!!file.exif_tags?.length && <small className="fm-extension-hint">检测到 {file.exif_tags.length} 项拍摄信息</small>}
        {file.symlink_info?.destination_path && <small className="fm-extension-hint">指向 {file.symlink_info.destination_path}</small>}
      </div>
      <div className="fm-review-metadata">
        {typeof file.size === 'number' && <strong>{size(file.size)}</strong>}
        {typeof file.modified_date === 'number' && file.modified_date > 0 && <small>{formatTime(file.modified_date * 1000)}</small>}
      </div>
    </li>
  }
  return <>
    <div className="fm-review-overview">
      <div className="fm-review-scope"><CheckCircle2 size={18} /><strong>{title}</strong><span>{task.finishedAt && formatTime(task.finishedAt)}</span></div>
      <div className="fm-metrics fm-scan-metrics">
        <div><small><File size={15} />匹配项</small><strong>{result.fileCount}</strong></div>
        {byGroup && <div><small><Layers3 size={15} />匹配分组</small><strong>{result.groupCount}</strong></div>}
        <div><small><HardDrive size={15} />匹配项合计</small><strong>{size(result.bytes)}</strong></div>
      </div>
    </div>
    {!applied && result.trashSelection === undefined && trashCommands.has(command) && task.status === 'succeeded' && !task.input.confirmChanges &&
      <div className="fm-review-actions"><span>重新扫描后可直接勾选清理。</span><button type="button" disabled={state.busy} onClick={() => void rescan()}>重新扫描</button></div>}
    <div className="fm-review-toolbar">
      <div className="fm-review-filters">
        {selectable && <div className="fm-segment" aria-label="结果范围">
          <button type="button" aria-pressed={view === 'all'} onClick={() => { setView('all'); setVisible(8) }}>全部结果</button>
          <button type="button" aria-pressed={view === 'selected'} onClick={() => { setView('selected'); setVisible(8) }}>已勾选 {picked.length}</button>
        </div>}
        <div className="fm-filter"><Search size={16} /><input aria-label="筛选扫描结果" placeholder="筛选文件名或路径" value={query}
          onChange={event => { setQuery(event.target.value); setVisible(8) }} />
          {query && <button type="button" aria-label="清除筛选" className="fm-icon-button" onClick={() => { setQuery(''); setVisible(8) }}><X size={14} /></button>}
        </div>
      </div>
      {(selectable || fix) && <div className="fm-review-actions">
        {selectable && <div className="fm-review-tools">
          <button type="button" className="fm-link" disabled={!visiblePaths.length || (picked.length >= limit && !visibleChecked)}
            onClick={() => update(visiblePaths, !visibleChecked)}>{visibleChecked ? '取消勾选当前显示' : '勾选当前显示'}</button>
          {view === 'all' && !query.trim() && suggestions.length > 0 && suggestions.length <= limit && <button type="button" className="fm-link"
            onClick={() => setSelected(new Set(suggestions))}>每组保留最新</button>}
          {picked.length > 0 && <button type="button" className="fm-link" onClick={() => setSelected(new Set())}>清空勾选</button>}
        </div>}
        <div className="fm-actions fm-review-apply">
          {selectable && picked.length > 0 && <small aria-live="polite">共 {size(pickedBytes)}</small>}
          {fix && <button type="button" className="primary" disabled={state.busy} onClick={() => confirm('fix')}><Wrench size={16} />{fix.label}</button>}
          {selectable && <button type="button" className="fm-trash-button" disabled={state.busy || !picked.length} onClick={() => confirm('trash')}><Trash2 size={16} />移入废纸篓</button>}
        </div>
      </div>}
    </div>
    {picked.length >= limit && <p className="fm-muted">每次最多处理 {limit} 项。</p>}
    {matches.length === 0 && <p className="fm-review-empty">{view === 'selected' && !picked.length ? '还没有勾选文件。' : '没有符合筛选条件的结果。'}</p>}
    {byGroup ? displayedGroups.map(group => <section className="fm-review-group" key={group.index}>
      <h3><Layers3 size={16} />第 {group.index + 1} 组 <small>{group.files.length} 项</small>
        <small className="fm-review-group-size">{size(group.files.reduce((sum, file) => sum + (file.size || 0), 0))}</small>
      </h3>
      <ul className={command === 'image' ? 'fm-review-gallery' : 'fm-review-list'}>
        {(expanded.has(group.index) ? group.files : group.files.slice(0, 4)).map(renderMatch)}
      </ul>
      {group.files.length > 4 && <button type="button" className="fm-link" onClick={() => setExpanded(previous => {
        const next = new Set(previous)
        if (next.has(group.index)) next.delete(group.index); else next.add(group.index)
        return next
      })}>{expanded.has(group.index) ? '收起' : `显示这组其余 ${group.files.length - 4} 项`}</button>}
    </section>) : <ul className="fm-review-list fm-review-group">{displayed.map(renderMatch)}</ul>}
    {(byGroup ? filtered.length : matches.length) > visible && <button type="button" className="fm-link" onClick={() => setVisible(visible + 16)}>显示更多结果</button>}
    {result.truncated && <p className="fm-muted">页面展示部分匹配项，完整清单可在任务详情导出。</p>}
    <dialog className="fm-dialog fm-image-dialog" ref={preview} aria-label="图片预览">
      <div className="fm-section-head"><h2>{image?.name}</h2><button type="button" onClick={() => preview.current?.close()}>关闭</button></div>
      {image && <img src={image.url} alt={image.name} />}
    </dialog>
    <dialog className="fm-dialog fm-review-dialog" ref={confirmation} aria-labelledby="cleanup-confirm-title">
      <h2 id="cleanup-confirm-title">{pending === 'trash' ? '确认移入废纸篓' : `确认${fix?.label}`}</h2>
      {pending === 'trash' ? <>
        <p>本次只处理已勾选的 <strong>{picked.length}</strong> 项，共 {size(pickedBytes)}。</p>
        <ul>{picked.map(file => <li key={file.path}>{file.path}</li>)}</ul>
      </> : <>
        <p>{fix?.detail} 将重新扫描以下目录并处理全部匹配项。</p>
        <ul>{task.input.paths.map((directory: string) => <li key={directory}>{directory}</li>)}</ul>
      </>}
      <div className="fm-actions">
        <button type="button" onClick={() => confirmation.current?.close()}>返回</button>
        <button type="button" className="primary" onClick={() => void apply()}>{pending === 'trash' ? '确认处理所选文件' : '开始处理'}</button>
      </div>
    </dialog>
  </>
}

export default function CleanupResults({ state, title, onReuse }: { state: EngineState; title: string; onReuse: (input: Task['input']) => void }) {
  const task = state.task
  const result = task?.result
  const followUp = task?.input.followUp
  const trash: TrashReport | undefined = result?.trash
  return <section className="fm-panel fm-result fm-cleanup-result" aria-label="扫描结果">
    <div className="fm-section-head"><h2><FileSearch size={19} />{followUp ? '处理结果' : '扫描结果'}</h2></div>
    {!task && <div className="fm-empty"><FileSearch size={29} /><strong>选择目录后开始扫描</strong><p>扫描完成后可查看结果并选择处理方式。</p></div>}
    {task && <>
      <TaskStatus state={state} task={task} working={followUp?.operation === 'trash' ? '正在移入废纸篓' : followUp ? '正在处理匹配项' : '正在扫描目录'} />
      {!trash && <TaskFailure task={task} />}
      {!taskIsActive(task) && !state.artifactDetailsReady && !state.artifactDetailsError && <p className="fm-muted">正在读取结果…</p>}
      {state.artifactDetailsError && <div className="fm-callout"><span>{state.artifactDetailsError}</span><button type="button" onClick={() => void state.refresh(true)}>重试</button></div>}
      {trash && <>
        <div className="fm-metrics fm-scan-metrics">
          <div><small>已移入废纸篓</small><strong>{trash.moved}</strong></div>
          <div><small>未处理</small><strong>{trash.total - trash.moved}</strong></div>
        </div>
        <ul className="fm-review-list fm-review-group fm-treatment-log">
          {trash.entries.map(file => <li className="fm-review-item" key={file.path}>
            <div className="fm-review-description"><strong>{fileName(file.path)}</strong><small>{file.path}</small></div>
            <span className={`fm-status fm-status-${file.status === 'moved' ? 'succeeded' : 'failed'}`}>{file.status === 'moved' ? '已移入废纸篓' : file.message}</span>
          </li>)}
        </ul>
      </>}
      {followUp?.operation === 'fix' && task.status === 'succeeded' && <div className="fm-result-summary fm-result-summary-success">
        <strong><CheckCircle2 size={19} />{task.message}</strong>
      </div>}
      {followUp?.operation === 'fix' && task.warnings && <details className="fm-details">
        <summary>查看处理警告</summary><div className="fm-details-body"><pre>{task.warnings}</pre></div>
      </details>}
      {followUp && !taskIsActive(task) && <button type="button" className="fm-link" onClick={() => state.setSelected(followUp.id)}>返回扫描结果</button>}
      {!followUp && result?.fileCount === 0 && <div className="fm-empty"><CheckCircle2 size={26} /><strong>未发现匹配项</strong></div>}
      {result?.fileCount > 0 && <MatchReview state={state} task={task} title={title} />}
      <TaskExtras state={state} onReuse={followUp ? undefined : onReuse} />
    </>}
  </section>
}
