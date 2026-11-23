import { ArrowRight, ArrowUpRight, ChevronRight, Clock3, ClosedCaption, FolderInput, ListChecks, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { creationTabs, mediaTabs, workspaces, type Tab } from './workspaces'
import { statusText, type ActivityRow } from './activity'

const descriptions = {
  图片处理: '批量压缩、裁剪、调色和水印',
  音视频处理: '剪辑、转码、提取音轨和生成 GIF',
  转写字幕: '本地转写、逐句校对和字幕导出',
  分镜动画: '编排镜头并渲染视频',
  口播: '用讲稿或配音生成口播视频',
  对话: '与角色交谈，将回复用作讲稿',
}

export function Navigation({ collapsed, toggle, tab, select, locked, importing, importDisabled, importHistory }: {
  collapsed: boolean; toggle: () => void
  tab: Tab; select: (tab: Tab) => void; locked: boolean; importing: boolean; importDisabled: boolean; importHistory: () => void
}) {
  const group = (name: string, tabs: readonly Tab[]) => <div className="nav-group" role="group" aria-label={name}>
    <p>{name}</p>
    {tabs.map(id => {
      const { title, icon: Icon } = workspaces[id]
      return <button key={id} title={title} aria-label={title} aria-current={tab === id ? 'page' : undefined} disabled={locked && id !== tab} onClick={() => select(id)}>
        <Icon size={17} aria-hidden="true" /><span>{title}</span>
      </button>
    })}
  </div>
  return <nav className="workspace-nav" aria-label="工作区"><div className="workspace-nav-inner">
    <button className="nav-toggle" aria-controls="studio-nav-groups" aria-expanded={!collapsed}
      title={collapsed ? '展开导航' : '收起导航'} aria-label={collapsed ? '展开导航' : '收起导航'} onClick={toggle}>
      {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span>收起导航</span>
    </button>
    <div className="nav-groups" id="studio-nav-groups">
      {group('工作空间', ['工作台', '任务'])}
      {group('媒体工具', mediaTabs)}
      {group('内容创作', creationTabs)}
    </div>
    <select className="nav-select" aria-label="切换工作区" value={tab} disabled={locked} onChange={event => select(event.target.value as Tab)}>
      {(Object.keys(workspaces) as Tab[]).map(id => <option key={id} value={id}>{workspaces[id].title}</option>)}
    </select>
    <button className="import-history" title="导入旧记录" aria-label={importing ? '正在导入…' : '导入旧记录'} disabled={importing || importDisabled} onClick={importHistory}>
      <FolderInput size={16} /><span>{importing ? '正在导入…' : '导入旧记录'}</span>
    </button>
  </div></nav>
}

function ToolArtwork({ tab }: { tab: typeof mediaTabs[number] }) {
  if (tab === '图片处理') return <span aria-hidden="true" className="tool-art art-photo">
    <span className="crop-frame"><i /><i /><i /><i /></span>
  </span>
  if (tab === '音视频处理') return <span aria-hidden="true" className="tool-art art-wave">
    <span className="wave-bars">{Array.from({ length: 74 }, (_, i) => {
      const envelope = 0.24 + 0.76 * Math.sin(i * 0.061 + 0.4) ** 2
      const sample = 0.15 + 0.85 * Math.abs(Math.sin(i * 2.3) * Math.cos(i * 0.32))
      return <i key={i} style={{ height: (10 + 90 * sample * envelope) + '%' }} />
    })}</span><span className="playhead" />
  </span>
  return <span aria-hidden="true" className="tool-art art-captions"><ClosedCaption size={49} strokeWidth={1.35} />
    <span className="caption-tracks"><i /><i /><i /><i /><i /></span>
  </span>
}

export function ActivityStatus({ status }: { status: string }) {
  return <span className={'activity-status status-' + status}><i />{statusText(status)}</span>
}

export function ActivityItem({ row, selected, onClick }: { row: ActivityRow; selected?: boolean; onClick: () => void }) {
  const Icon = workspaces[row.image ? '图片处理' : row.kind === '字幕' ? '转写字幕' : row.kind === '分镜' ? '分镜动画' : row.kind === '口播' ? '口播' : '音视频处理'].icon
  const date = new Date(row.createdAt)
  const hasTime = Number.isFinite(date.getTime())
  return <button className="activity-item" data-task-key={row.key} title={row.title} aria-pressed={selected} onClick={onClick}>
    <span className="activity-icon"><Icon size={17} /></span>
    <span className="activity-name"><strong>{row.title}</strong><small>{row.operation}{hasTime && <> · <time dateTime={date.toISOString()}>{date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></>}</small></span>
    <ActivityStatus status={row.status} />
    <ChevronRight size={15} className="activity-chevron" />
  </button>
}

export function Workbench({ select, rows, openTask, loaded }: {
  select: (tab: Tab) => void; rows: ActivityRow[]; openTask: (row: ActivityRow) => void; loaded: boolean
}) {
  return <div className="workbench-home">
    <section aria-labelledby="media-tools-title">
      <h2 id="media-tools-title" className="workspace-heading">媒体工具</h2>
      <div className="tool-cards">{mediaTabs.map(tab =>
        <button className="tool-card" key={tab} onClick={() => select(tab)}>
          <ToolArtwork tab={tab} />
          <span className="tool-copy"><strong>{tab}</strong><ArrowUpRight size={17} /><small>{descriptions[tab]}</small></span>
        </button>)}</div>
    </section>
    <section aria-labelledby="creation-title">
      <h2 id="creation-title">内容创作</h2>
      <div className="creation-tools">{creationTabs.map(tab => {
        const { title, icon: Icon } = workspaces[tab]
        return <button key={tab} onClick={() => select(tab)}>
          <Icon size={22} strokeWidth={1.5} /><span><strong>{title}</strong><small>{descriptions[tab]}</small></span><ChevronRight size={15} />
        </button>
      })}</div>
    </section>
    <section aria-labelledby="recent-title">
      <div className="workbench-heading-row"><h2 id="recent-title"><Clock3 size={17} />最近任务</h2><button className="quiet-link" onClick={() => select('任务')}>查看全部<ArrowRight size={15} /></button></div>
      <div className="activity-list">{rows.length ? rows.slice(0, 5).map(row => <ActivityItem key={row.key} row={row} onClick={() => openTask(row)} />)
        : <div className="activity-empty"><ListChecks size={22} /><p>{loaded ? '暂无任务，选择上方工具开始处理文件。' : '正在读取任务记录…'}</p></div>}</div>
    </section>
  </div>
}
