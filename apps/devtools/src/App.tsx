import { useEffect, useState } from 'react'
import { Braces, Clock3, Binary, KeyRound, Wrench } from 'lucide-react'
import { runtimeStatus } from './lib/host'
import { TimestampTool } from './components/TimestampTool'
import { Base64Tool } from './components/Base64Tool'
import { JsonTool } from './components/JsonTool'
import { AesTool } from './components/AesTool'
const tools = [{ id: 'timestamp', title: '时间戳', icon: Clock3, component: TimestampTool }, { id: 'base64', title: 'Base64', icon: Binary, component: Base64Tool }, { id: 'aes', title: 'AES', icon: KeyRound, component: AesTool }, { id: 'json', title: 'JSON', icon: Braces, component: JsonTool }]
const route = () => tools.find(tool => location.hash === `#/${tool.id}`)?.id || 'timestamp'
export function App() {
  const [active, setActive] = useState(route), [status, setStatus] = useState('正在准备…')
  useEffect(() => { const changed = () => setActive(route()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed) }, [])
  useEffect(() => {
    let disposed = false, pending = false, again = false
    const refresh = async () => {
      if (disposed) return
      if (pending) { again = true; return }
      pending = true
      try { const value = await runtimeStatus(); if (!disposed) setStatus(value) }
      catch { if (!disposed) setStatus('暂时无法连接本地服务，请重试') }
      finally { pending = false; if (again && !disposed) { again = false; void refresh() } }
    }
    const off = window.mossApp?.events.on('runtime', () => void refresh())
    void refresh(); window.addEventListener('focus', refresh); window.addEventListener('devtools-operation', refresh)
    return () => { disposed = true; off?.(); window.removeEventListener('focus', refresh); window.removeEventListener('devtools-operation', refresh) }
  }, [])
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><Wrench size={19} /><span>开发工具</span></div><nav aria-label="开发工具分类">{tools.map(({ id, title, icon: Icon }) => <a key={id} href={`#/${id}`} aria-current={active === id ? 'page' : undefined}><Icon size={17} /><span>{title}</span></a>)}</nav><div className="sidebar-note">常用转换，随手完成。</div></aside><div className="main-column"><main>{tools.map(({ id, component: Panel }) => <section key={id} aria-label={tools.find(t => t.id === id)!.title + '工作区'} hidden={active !== id}><Panel /></section>)}</main><footer className="app-footer"><span>{status}</span><span>本地处理 · 不保存输入与密钥</span></footer></div></div>
}
