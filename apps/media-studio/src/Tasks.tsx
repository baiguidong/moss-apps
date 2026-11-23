import { useEffect, useRef, useState } from 'react'
import { Artifacts, TaskDetails, size, type EngineState } from '@moss/engine-apps/ui'
import { ArrowLeft, Download, FileImage, ListChecks, RefreshCw, Search } from 'lucide-react'
import type { Call } from './types'
import { isActive, type ActivityRow, type ImageJob } from './activity'
import { ActivityItem, ActivityStatus } from './Workbench'

export function Tasks({ state, call, rows, selected, select, refresh, ready, open, restore, openFeature, openImage }: {
  state: EngineState; call: Call; rows: ActivityRow[]; selected: string; select: (key: string) => void
  refresh: () => void; ready: boolean; open: (id: string) => void; restore: (input: any) => void
  openFeature: (tab: '分镜动画' | '转写字幕', id: string) => void; openImage: (id: string) => void
}) {
  const [kind, setKind] = useState('全部'), [query, setQuery] = useState('')
  const [status, setStatus] = useState('all'), [working, setWorking] = useState(false)
  const filtered = Boolean(query || kind !== '全部' || status !== 'all')
  const match = query.trim().toLocaleLowerCase()
  const visible = rows.filter(row => (kind === '全部' || row.kind === kind) &&
    (status === 'all' || (status === 'active' ? isActive(row.status) : row.status === status)) &&
    [row.title, row.operation, row.media?.input.path, ...(row.image?.fileNames || []), ...(row.image?.results.map(f => f.name) || [])]
      .some(text => text?.toLocaleLowerCase().includes(match)))
  const row = visible.find(row => row.key === selected) || visible[0]
  const media = row?.media, image = row?.image
  const backButton = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLElement>(null)
  const detailOpen = Boolean(row && row.key === selected)
  useEffect(() => {
    if (detailOpen && backButton.current?.offsetWidth) backButton.current.focus({ preventScroll: true })
  }, [detailOpen, selected])
  function backToList() {
    select('')
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[data-task-key="' + CSS.escape(selected) + '"]')?.focus())
  }
  useEffect(() => { if (media) state.setSelected(media.id) }, [media?.id, state.setSelected])
  async function run(action: () => Promise<unknown>) {
    setWorking(true)
    state.setError('')
    state.setNotice('')
    try { await action() } catch (e) { state.setError((e as Error).message) }
    finally { setWorking(false) }
  }
  function reveal(key: string) {
    setQuery('')
    setKind('全部')
    setStatus('all')
    select(key)
    refresh()
  }
  async function repeatImage(task: ImageJob) {
    const job = await call('image.tasks.retry', { id: task.id })
    reveal('image-' + job.id)
  }
  async function exportImages(ids: string[]) {
    const result = await call('image.files.export', { ids })
    if (!result.canceled) state.setNotice('已导出 ' + result.files.length + ' 个文件')
  }
  async function retryMedia() {
    if (!media) return
    const { input } = media
    if (input.project) {
      const job = await call('renders.retry', { id: media.id })
      state.setSelected(job.id)
      open(input.project.id)
    } else if (input.mode === 'animation') openFeature('分镜动画', input.projectId)
    else {
      const job = input.mode === 'transcribe'
        ? await state.invoke('recording.tasks.start', input)
        : await state.start(input)
      if (job) reveal('media-' + job.id)
    }
  }
  return <div className="task-center" data-detail={detailOpen}>
    <div className="workbench-heading-row"><h2 className="workspace-heading">任务中心</h2>
      <button onClick={refresh}><RefreshCw size={15} />刷新</button></div>
    <div className="task-filters">
      <label className="task-search"><Search size={16} /><input aria-label="搜索任务" type="search" placeholder="搜索文件、项目或操作" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="任务类型" value={kind} onChange={e => setKind(e.target.value)}>
        {['全部', '图片', '音视频', '字幕', '分镜', '口播'].map(k => <option key={k} value={k}>{k === '全部' ? '全部类型' : k}</option>)}
      </select>
      <select aria-label="任务状态" value={status} onChange={e => setStatus(e.target.value)}>
        <option value="all">全部状态</option><option value="active">进行中</option><option value="succeeded">已完成</option>
        <option value="failed">失败</option><option value="interrupted">已中断</option><option value="canceled">已取消</option>
        {rows.some(item => item.status === 'partial') && <option value="partial">部分完成</option>}
      </select>
    </div>
    {!row ? <div className="activity-empty"><ListChecks size={24} /><p>{filtered ? '没有匹配的任务。' : ready ? '暂无任务记录。' : '正在读取任务记录…'}</p>
      {filtered && <button onClick={() => { setQuery(''); setKind('全部'); setStatus('all') }}>清除筛选</button>}</div>
      : <div className="task-columns">
        <section ref={list} className="activity-list" aria-label="任务记录">{visible.map(item => <ActivityItem key={item.key} row={item} selected={row.key === item.key} onClick={() => select(item.key)} />)}</section>
        <div className="task-detail">
          <div className="task-detail-heading">
            <button ref={backButton} onClick={backToList}><ArrowLeft size={15} />返回任务列表</button>
            <strong>{row.title}</strong>
          </div>
          {image && <section className="result-panel">
            <div className="section-heading"><h2>图片处理结果</h2><ActivityStatus status={image.status} /></div>
            <p className="task-message">{image.message}</p>
            {isActive(image.status) && <progress max={100} value={image.progress} aria-label="图片处理进度" />}
            {image.results.map(file => <div className="image-output" key={file.id}>
              <FileImage size={19} /><span><strong>{file.name}</strong><small>{size(file.size)}</small></span>
              <button onClick={() => openImage(file.id)}>查看图片</button>
            </div>)}
            <div className="task-actions">
              {image.results.length > 0 && <button className="primary" disabled={working} onClick={() => void run(() => exportImages(image.results.map(file => file.id)))}><Download size={15} />导出结果</button>}
              {isActive(image.status)
                ? <button disabled={working || image.status === 'canceling'} onClick={() => void run(async () => { await call('image.tasks.cancel', { id: image.id }); refresh() })}>取消任务</button>
                : <button disabled={working} onClick={() => void run(() => repeatImage(image))}>重新运行</button>}
            </div>
          </section>}
          {media && <>
            {state.task?.id === media.id ? <TaskDetails state={state}><Artifacts state={state} /></TaskDetails> : <p role="status">正在读取任务结果…</p>}
            <div className="task-actions">
              {!media.input.project && !['raw', 'transcribe', 'animation'].includes(media.input.mode) && <button onClick={() => restore(media.input)}>调整参数</button>}
              {media.input.mode === 'transcribe' && media.status === 'succeeded' && <button onClick={() => openFeature('转写字幕', media.id)}>校对字幕</button>}
              {media.input.project && <button onClick={() => open(media.input.project.id)}>打开项目</button>}
              {media.input.mode === 'animation' && <button onClick={() => openFeature('分镜动画', media.input.projectId)}>打开分镜</button>}
              {isActive(media.status) ? <button disabled={state.busy || media.status === 'canceling'} onClick={() => void state.invoke('tasks.cancel', { id: media.id })}>取消任务</button>
                : media.input.mode !== 'animation' && <button disabled={working || state.busy} onClick={() => void run(retryMedia)}>重新运行</button>}
            </div>
          </>}
        </div>
      </div>}
  </div>
}
