import { useEffect, useState } from 'react'
import { CircleAlert, HardDrive, ScanLine, X } from 'lucide-react'
import { useEngineApp } from '@moss/engine-apps/ui'
import Backup from './Backup'
import Cleanup from './Cleanup'
import backupCommands from './backup-commands.json'
import './file-management.css'

function currentPage() {
  return location.hash === '#/backup' ? 'backup' : 'cleanup'
}

export default function App() {
  const [page, setPage] = useState(currentPage)
  const state = useEngineApp({
    pollWhenIdle: false,
    summaryAction: 'workspace.summary',
    taskFilter: task => backupCommands.includes(task.input.command) === (page === 'backup'),
  })
  useEffect(() => {
    const onNavigate = () => setPage(currentPage())
    window.addEventListener('hashchange', onNavigate)
    return () => window.removeEventListener('hashchange', onNavigate)
  }, [])

  const importHistory = async () => {
    const result = await state.invoke('history.import')
    if (!result) return
    const counts = [
      result.imported && `已导入 ${result.imported} 条`, result.existing && `${result.existing} 条已存在`,
      result.active && `${result.active} 条仍在运行，可稍后重试`, result.skipped && `${result.skipped} 条无法导入`,
    ].filter(Boolean)
    state.setNotice(counts.join(' · ') || '未找到可导入的旧任务')
  }
  const historyAction = <button type="button" className="fm-link" disabled={state.busy} onClick={() => void importHistory()}>导入旧任务</button>

  return <main className="fm-app" data-app-primary>
    <nav className="file-management-nav" aria-label="文件管理">
      <a href="#/cleanup" aria-current={page === 'cleanup' ? 'page' : undefined}><ScanLine size={18} />文件清理</a>
      <a href="#/backup" aria-current={page === 'backup' ? 'page' : undefined}><HardDrive size={18} />备份与恢复</a>
    </nav>
    {state.error && <div role="alert" className="fm-callout fm-callout-error">
      <CircleAlert size={18} /><span>{state.error}</span><button type="button" className="fm-icon-button" aria-label="关闭提示" onClick={() => state.setError('')}><X size={16} /></button>
    </div>}
    {state.notice && <p role="status" className="fm-callout">{state.notice}</p>}
    {page === 'cleanup' ? <Cleanup historyAction={historyAction} state={{ ...state, catalog: state.catalog?.cleanup }} /> : <Backup historyAction={historyAction} state={state} />}
  </main>
}
