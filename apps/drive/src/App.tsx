import { useEffect, useSyncExternalStore } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, FolderPlus, Trash2, ChevronRight, Cloud, CloudOff, FolderOpen, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { FileIcon } from './components/FileIcon'
import { Transfers } from './components/Transfers'
import { FileDialog } from './components/FileDialog'
import { bytes, date, fullDate } from './lib/format'
import type { DriveState, DriveStore, DriveView } from './lib/store'

const cloudMessages: Record<string, [string, string]> = {
  loading: ['正在连接网盘', '即将显示你的云端文件。'],
  remote_disabled: ['尚未连接服务器', '请在 Moss 设置中开启远程连接。'],
  unauthenticated: ['需要登录服务器', '请在 Moss 设置中登录后重试。'],
  unconfigured: ['网盘尚未配置', '请在 Moss 设置中连接服务器，并确认已启用云端存储。'],
  disabled: ['云端存储未启用', '请联系服务器管理员启用云端存储。'],
  unsupported: ['服务器暂不支持网盘', '请升级到支持云端存储的 Moss Server。'],
  unavailable: ['暂时无法连接网盘', '请检查服务器连接，然后重试。'],
  target_mismatch: ['服务器连接不匹配', '请在 Moss 设置中确认当前服务器。'],
  forbidden: ['暂无访问权限', '请检查应用授权，或联系服务器管理员。'],
}
const runtimeLabel = (state: DriveState) => state.runtime.error ? '服务调用失败' : ({ running: '服务运行中', starting: '服务启动中', stopped: '服务已停止', stopping: '服务正在停止', error: '服务异常退出', disabled: '应用已停用', 'crash-loop': '服务反复退出', 'crash-looping': '服务反复退出', crashed: '服务异常退出', demo: '浏览器演示' }[state.runtime.state] || '服务暂不可用')

export function App({ store }: { store: DriveStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    store.start()
    const focus = () => { void store.refresh() }
    const visible = () => { if (document.visibilityState === 'visible') focus() }
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible) }
  }, [store])
  const ready = state.cloud === 'ready'
  const tabs = [{ id: 'files', label: '全部文件', icon: FolderOpen }, { id: 'upload', label: '上传', icon: ArrowUpFromLine }, { id: 'download', label: '下载', icon: ArrowDownToLine }] as const
  const runtimeDisabled = state.runtime.state === 'disabled'
  const [title, description] = runtimeDisabled ? ['网盘已停用', '请在 Moss 的应用管理中启用网盘。'] : cloudMessages[state.cloud] || cloudMessages.unavailable
  const upload = <button className="primary" disabled={!ready || state.picking} onClick={() => void store.upload()}>{state.picking ? <LoaderCircle size={16} className="spin" /> : <ArrowUpFromLine size={16} />}<span>{state.picking ? '正在选择' : '上传文件'}</span></button>
  return <main className="app-shell">
    <div className="workspace">
      <h1 className="sr-only">网盘</h1>
      <header className="toolbar">
        <nav className="workspace-tabs" role="tablist" aria-label="网盘导航" onKeyDown={event => {
          const index = tabs.findIndex(tab => tab.id === state.view)
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
          if (next < 0) return
          event.preventDefault(); store.setView(tabs[next].id)
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus()
        }}>
          {tabs.map(tab => {
            const count = state.tasks.filter(task => task.direction === tab.id && !['completed', 'cancelled'].includes(task.state)).length
            return <button key={tab.id} id={`tab-${tab.id}`} role="tab" aria-label={tab.label} aria-selected={state.view === tab.id} aria-controls={`view-${tab.id}`} tabIndex={state.view === tab.id ? 0 : -1} onClick={() => store.setView(tab.id as DriveView)}><tab.icon size={15} /><span>{tab.label}</span>{count > 0 && <span className="badge" aria-hidden="true">{count}</span>}</button>
          })}
        </nav>
        {state.view === 'files' && <div className="actions">
          <button className="quiet" disabled={!ready} onClick={store.openCreateFolder}><FolderPlus size={16} /><span>新建目录</span></button>
          <button className="quiet refresh-button" aria-label="更新文件列表" title="更新文件列表，保留当前目录" disabled={state.refreshing} onClick={() => void store.refresh()}><RefreshCw size={16} className={state.refreshing ? 'spin' : ''} /><span>更新列表</span></button>
          {upload}
        </div>}
      </header>
      {state.view === 'files' && state.path.length > 1 && <nav className="breadcrumbs" aria-label="文件路径">
        {state.path.map((crumb, index) => <span className="crumb" key={crumb.id || 'root'}>
          {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
          <button className="crumb-button" title={crumb.name} disabled={!ready} aria-current={index === state.path.length - 1 ? 'page' : undefined} onClick={() => void store.back(index)}>{crumb.name}</button>
        </span>)}
      </nav>}
      {store.api.demo && <div className="demo-banner">浏览器演示<span>文件与进度仅在本页模拟，不会写入云端。</span></div>}
      <div className="messages">
        {state.operationErrors.map(error => <div className="notice error-notice" role="alert" key={error.id}><span><strong>{error.name}</strong>：{error.message}</span><button className="icon-button" aria-label={`关闭 ${error.name} 错误提示`} onClick={() => store.dismissError(error.id)}><X size={14} /></button></div>)}
        {state.runtime.error && ready && <div className="inline-error" role="alert">网盘服务调用失败，请刷新重试。</div>}
      </div>
      <section className="file-workspace" role="tabpanel" id={`view-${state.view}`} aria-labelledby={`tab-${state.view}`}>
        {!ready ? <div className="empty-state" role="status"><span className="empty-icon">{state.cloud === 'loading' ? <Cloud size={34} /> : <CloudOff size={34} />}</span><h2>{title}</h2><p>{description}</p>{state.cloud !== 'loading' && <button className="quiet bordered" disabled={state.refreshing} onClick={() => void store.refresh()}><RefreshCw size={15} />重新连接</button>}</div>
          : state.view !== 'files' ? <Transfers key={state.view} state={state} store={store} direction={state.view} /> : <>
            <div className="file-scroll" aria-busy={state.listLoading}>
              <table className="file-table"><thead><tr><th scope="col">名称</th><th scope="col" className="size-column">大小</th><th scope="col" className="date-column">修改时间</th><th scope="col" className="action-column"><span className="sr-only">操作</span></th></tr></thead>
                <tbody>{state.files.map(file => <tr key={file.id} data-testid="file-row">
                  <td><div className="file-name"><FileIcon name={file.name} folder={file.kind === 'folder'} /><div className="file-description">{file.kind === 'folder' ? <button className="folder-link" title={file.name} onClick={() => void store.enter(file)}>{file.name}</button> : <span className="name-text" title={file.name}>{file.name}</span>}<span className="mobile-meta">{file.kind === 'folder' ? '文件夹' : bytes(file.size)}<span>·</span>{date(file.updatedAt)}</span></div></div></td>
                  <td className="size-column muted">{file.kind === 'folder' ? '—' : bytes(file.size)}</td>
                  <td className="date-column muted"><time dateTime={new Date(file.updatedAt).toISOString()} title={fullDate(file.updatedAt)}>{date(file.updatedAt)}</time></td>
                  <td className="action-column">{file.kind === 'file' ? <div className="file-actions"><button className="download-button" aria-label={`下载 ${file.name}`} title="下载文件" disabled={state.downloads.includes(file.id)} onClick={() => void store.download(file)}>{state.downloads.includes(file.id) ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}<span>下载</span></button><button className="icon-button delete-button" aria-label={`删除 ${file.name}`} title="删除文件" onClick={() => store.openDeleteFile(file)}><Trash2 size={15} /></button></div> : <ChevronRight className="folder-chevron" size={15} aria-hidden="true" />}</td>
                </tr>)}</tbody>
              </table>
              {state.listLoading && !state.files.length ? <div className="empty-state loading-state" role="status"><LoaderCircle className="spin" size={24} /><p>正在加载文件…</p></div> : !state.files.length && !state.listError && <div className="empty-state"><span className="empty-icon"><FolderOpen size={34} /></span><h2>还没有文件</h2><p>上传文件，留存值得保存的内容。</p><button className="quiet bordered" disabled={state.picking} onClick={() => void store.upload()}><ArrowUpFromLine size={15} />上传文件</button></div>}
              {state.listError && <div className="list-error" role="alert"><p>{state.listError}</p><button className="quiet bordered" onClick={() => void store.loadFiles()}><RefreshCw size={15} />重试</button></div>}
              {state.cursor && <div className="load-more"><button className="quiet bordered" disabled={state.listLoading} onClick={() => void store.loadFiles(true)}>{state.listLoading && <LoaderCircle size={14} className="spin" />}加载更多</button></div>}
            </div>
          </>}
        <footer className="workspace-footer">
          <div className="footer-left"><span>{ready ? state.view === 'files' ? `已加载 ${state.files.length} 项` : `${state.tasks.filter(task => task.direction === state.view).length} 项记录` : '个人云端空间'}</span>
            <span className={`runtime-status ${['running', 'demo'].includes(state.runtime.state) && !state.runtime.error ? 'healthy' : ''}`} role="status"><i />{runtimeLabel(state)}</span></div>
          <div className="quota" title={state.quota ? `已用 ${bytes(state.quota.usedBytes)}，传输预留 ${bytes(state.quota.reservedBytes)}，总容量 ${bytes(state.quota.limitBytes)}` : undefined}>
            {state.quota ? <><span className="quota-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, state.quota.limitBytes > 0 ? (state.quota.usedBytes + state.quota.reservedBytes) / state.quota.limitBytes * 100 : 0)}%` }} /></span><span>{bytes(state.quota.usedBytes)} / {bytes(state.quota.limitBytes)}</span></> : <span>{state.quotaError ? '容量暂不可用' : '—'}</span>}
          </div>
        </footer>
      </section>
      {state.dialog && <FileDialog dialog={state.dialog} store={store} />}
      {state.notice && <span className="sr-only" role="status" data-testid="transfer-announcement">{state.notice}</span>}
    </div>
  </main>
}
