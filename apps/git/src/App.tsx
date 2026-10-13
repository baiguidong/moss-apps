import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, GitBranch, Loader2, FolderArchive, RefreshCw, Search, Settings2, Wrench } from 'lucide-react'
import { SERVICE, SERVICE_VERSION, TITLE } from './contracts'
import type { Catalog, SaveInput } from './contracts'
import { request } from './lib/api'
import { SettingsEditor } from './components/settings-editor'
import './service.css'

const date = (value: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [editor, setEditor] = useState(false)
  const [query, setQuery] = useState(''), [unavailable, setUnavailable] = useState(false)
  const mounted = useRef(true), revision = useRef(0)
  const load = useCallback(async () => {
    const current = ++revision.current
    try {
      const result = await request('servers.list')
      if (mounted.current && current === revision.current) { setCatalog(result); setError('') }
    } catch (cause) {
      if (mounted.current && current === revision.current) setError(cause instanceof Error ? cause.message : '读取Git 仓库服务状态失败。')
    }
  }, [])
  useEffect(() => {
    mounted.current = true; void load()
    const refreshRuntime = async () => {
      if (!window.mossApp) return
      try {
        const [status, installation] = await Promise.all([window.mossApp.app.getStatus(), window.mossApp.app.getInstallationState()])
        if (mounted.current) setUnavailable((installation?.installation as { enabled?: boolean })?.enabled === false || !['running', 'starting'].includes(String(status?.state)))
      } catch { if (mounted.current) setUnavailable(true) }
    }
    void refreshRuntime()
    const offStatus = window.mossApp?.events.on('service.changed', () => { void load() })
    const offRuntime = window.mossApp?.events.on('runtime', () => { void refreshRuntime(); void load() })
    return () => { mounted.current = false; ++revision.current; offStatus?.(); offRuntime?.() }
  }, [load])
  const connecting = Boolean(catalog && ['configuring', 'connecting'].includes(catalog.preparation.state))
  useEffect(() => {
    if (!connecting || busy || unavailable || error) return
    const timer = setTimeout(() => { void load() }, 750)
    return () => clearTimeout(timer)
  }, [catalog, connecting, busy, unavailable, error, load])
  const server = catalog?.servers.find(item => item.name === SERVICE)
  const failed = error || catalog?.preparation.error || (!connecting && server?.check?.state === 'failed' ? server.check.error : '')
  const checked = !connecting && !failed && server?.check?.state === 'connected'
  const sessionOnly = !catalog?.settings.directories.length
  const label = unavailable ? 'App 未运行' : connecting ? (catalog?.preparation.state === 'configuring' ? '正在配置' : '正在检查') : failed ? '检查失败' : checked ? '服务可用' : '等待检查'
  const inspectService = async () => {
    ++revision.current; setBusy(true); setError('')
    try { const result = await request('servers.inspect', {}); if (mounted.current) setCatalog(result) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '服务检查失败。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const save = async (input: SaveInput) => {
    ++revision.current; setBusy(true)
    try { const result = await request('servers.save', input); if (mounted.current) { setCatalog(result); setError('') } }
    finally { if (mounted.current) { setBusy(false); void load() } }
  }
  const tools = (server?.check?.tools || []).filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))

  return <main className="app-shell"><div className="service-workspace">
    <header className="service-header"><div className="service-brand"><span className="service-mark"><GitBranch size={24} strokeWidth={1.6} /></span><div><h1>{TITLE}</h1><p>Git <span className="official-tag">官方</span></p></div></div><button className="button" onClick={() => setEditor(true)} disabled={!catalog || busy || unavailable}><Settings2 size={15} />Git 仓库设置</button></header>
    {!window.mossApp && <div className="demo-note">演示模式 · 仅展示界面，操作不会访问真实目录或仓库</div>}
    <section className="service-card connection-card" aria-label="Git 仓库服务状态" aria-busy={connecting}>
      <div className="connection-top"><span className={`service-status ${failed || unavailable ? 'failure' : checked ? 'ready' : ''}`} role="status">{connecting || (!catalog && !error) ? <Loader2 size={16} className="spin" /> : failed || unavailable ? <CircleAlert size={16} /> : <Check size={16} />}{!catalog && !error ? '正在读取状态' : label}</span><button className="button primary" onClick={() => void inspectService()} disabled={busy || connecting || unavailable}><RefreshCw size={15} className={busy ? 'spin' : ''} />检查服务</button></div>
      <h2>在对话中管理本地 Git 仓库</h2><p className="service-lead">查看改动和提交历史，按需暂存、提交与切换分支。</p>
      {unavailable && <p className="service-error" role="alert">请在 Moss 应用管理中启用Git 仓库并检查权限。</p>}
      {failed && <p className="service-error" role="alert">{failed}</p>}
      {sessionOnly && <div className="service-target"><FolderArchive size={18} /><div><strong>默认使用当前会话工作目录</strong><span>公共仓库可选；会话目录优先，也可指定公共仓库。</span></div><button className="button" onClick={() => setEditor(true)} disabled={busy || unavailable}>添加公共目录</button></div>}
      {!sessionOnly && <div className="service-target"><FolderArchive size={18} /><div><strong>公共仓库目录 · {catalog?.settings.directories.length || 0} 个</strong><ul className="directory-list">{catalog?.settings.directories.map(directory => <li key={directory}>{directory}</li>)}</ul></div>{checked && server?.check && <small>最近检查 {date(server.check.checkedAt)}</small>}</div>}
      <p className="service-note">会话工作目录自动追加并优先使用；公共仓库在各会话中可用。需要本机已安装 Git。</p>
    </section>
    <div className="service-guides"><section className="service-card"><span className="section-kicker">开始使用</span><h3>在对话中试试这些任务</h3><ul className="example-list"><li>查看这个仓库有哪些未提交的改动</li><li>比较当前改动与上次提交的差异</li><li>创建新分支，并提交我确认过的改动</li></ul></section><section className="service-card"><span className="section-kicker">使用范围</span><h3>会话优先，公共仓库可选</h3><p>默认操作当前会话的仓库，也可指定公共仓库。清空公共目录后仍可使用会话工作目录。提交沿用 Git 配置中的姓名和邮箱。</p><p className="service-note">检查服务会验证启动和工具可用性。修改设置后，忙碌对话会在本轮结束后更新。</p></section></div>
    <details className="service-card service-tools"><summary><Wrench size={16} /><span>工具详情</span><small>{server?.check?.tools.length || 0} 项</small><ChevronDown size={15} /></summary><div className="service-tools-body"><div className="search-field"><Search size={15} /><input aria-label="搜索工具" placeholder="查找工具" value={query} onChange={event => setQuery(event.target.value)} /></div>{tools.map(tool => <article className="tool-row" key={tool.name}><Wrench size={15} /><div><h4>{tool.name}{tool.disabled && <span className="muted-badge">已排除</span>}</h4><p>{tool.description || '此工具未提供描述。'}</p></div></article>)}{!tools.length && <p className="service-note">{query ? '没有匹配的工具。' : connecting ? '正在读取工具目录…' : '服务检查完成后展示可用工具。'}</p>}<p className="service-note">Git 参考接口 {SERVICE_VERSION} · Node 适配 · 随应用提供{server?.check?.truncated ? ' · 当前展示部分工具' : ''}。</p></div></details>
    <footer className="service-footer">在应用管理中启用或停用Git 仓库</footer>
  </div>{editor && catalog && <SettingsEditor settings={catalog.settings} onClose={() => setEditor(false)} onSave={save} />}</main>
}
