import { useEffect, useState } from 'react'
import { BookOpen, Check, CircleAlert, Download, LoaderCircle, RefreshCw, X } from 'lucide-react'
import type { EngineStatus } from '../lib/api'

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${(value / 1024).toFixed(0)} KB`

export function EngineSetup({ status, busy, onStart, onCancel }: {
  status: EngineStatus | null; busy: boolean; onStart: () => void; onCancel: () => void
}) {
  const active = status?.state === 'installing' || status?.state === 'starting'
  const progress = status?.preparation, failed = status?.state === 'failed'
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  const since = active && progress ? Math.max(0, now - progress.observedAt) : 0
  const idle = (progress?.idleMs || 0) + since
  const current = progress?.steps.findIndex(step => step.id === progress.stage) ?? -1
  const title = !status ? '正在读取引擎状态…' : failed ? '检索引擎未能就绪' : active ? (status.installed ? '正在启动检索服务' : '正在准备检索引擎') : status.installed ? '启动检索服务' : '准备你的语义知识库'
  const download = progress?.download
  const percent = download ? Math.floor(download.completed / download.total * 100) : null
  return <section className="setup" aria-label="引擎准备进度">
    <div className="setup-heading"><div className="setup-icon">{failed ? <CircleAlert size={22}/> : <BookOpen size={22}/>}</div><div><h2>{title}</h2><p>{progress ? `已用 ${duration(progress.elapsedMs + since)}${active ? ` · 当前步骤 ${duration(progress.stageElapsedMs + since)}` : ''}` : '首次下载引擎依赖与约 130 MB 模型，之后从本机加载。'}</p></div>{active && <LoaderCircle size={18} className="spin"/>}</div>
    {progress && <>
      <ol className="setup-steps" aria-label="准备步骤">{progress.steps.map((step, index) => <li key={step.id} data-state={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
        <span className="step-icon">{step.state === 'done' || step.state === 'cached' ? <Check size={13}/> : step.state === 'active' ? <LoaderCircle size={13} className="spin"/> : step.state === 'failed' ? <X size={13}/> : index + 1}</span><span>{step.label}<small>{step.state === 'cached' ? '已安装' : step.state === 'done' ? '已完成' : step.state === 'failed' ? '未完成' : step.state === 'cancelled' ? '已取消' : step.state === 'active' ? '进行中' : '等待'}</small></span>
      </li>)}</ol>
      <div className="setup-current" role="status" aria-live="polite">
        <div className="setup-current-label"><span>{current >= 0 ? `步骤 ${current + 1} / ${progress.steps.length} · ${progress.steps[current].label}` : '正在检查本地引擎'}</span>{download && <span>{percent}%</span>}</div>
        <p>{progress.detail || status?.message}</p>
        {active && <progress aria-label={download ? '当前文件下载进度' : '当前步骤进行中'} max={download?.total || 100} value={download?.completed}/>}
        {download && <div className="download-size"><Download size={13}/><span>{bytes(download.completed)} / {bytes(download.total)} · 当前文件</span></div>}
      </div>
      {active && idle >= 30000 && <p className="setup-stalled" role="status"><CircleAlert size={15}/><span>已有 {duration(idle)} 未收到新输出。{['model','dependencies'].includes(progress.stage || '') ? '下载可能正在等待网络响应，请检查网络或代理；也可以取消后重试。' : '本地服务仍在处理中；若持续无响应，可以取消后重试。'}</span></p>}
      {progress.logs.length > 0 && <div className="setup-output"><div className="latest-output"><span>最近输出</span><code>{progress.logs.at(-1)}</code></div><details><summary>查看详细输出</summary><pre>{progress.logs.join('\n')}</pre></details></div>}
    </>}
    {!progress && <p className="setup-description">{status?.message || '资料检索在本机运行。准备完成后，即可导入资料并搜索。'}</p>}
    {status?.error && <pre role="alert" className="setup-error">{status.error}</pre>}
    <div className="setup-actions">{active ? <><button disabled={busy} onClick={onCancel}>{busy ? <LoaderCircle size={15} className="spin"/> : <X size={15}/>}取消准备</button><span>关闭页面后，准备会在后台继续。</span></> : <button className="primary" disabled={busy || !status} onClick={onStart}>{busy || !status ? <LoaderCircle size={15} className="spin"/> : failed || status.installed ? <RefreshCw size={15}/> : <Download size={15}/>} {status?.installed ? '启动 / 重试' : failed ? '重新准备' : '准备引擎'}</button>}</div>
  </section>
}
