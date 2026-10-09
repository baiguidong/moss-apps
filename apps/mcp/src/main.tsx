import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { syncAppearance } from './lib/appearance'
import { cancelRequests } from './lib/api'
import './theme.css'
import './styles.css'
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <main className="startup-fallback"><h1>MCP 暂时无法显示</h1><p>请重新打开应用后重试。</p><button className="button" onClick={() => location.reload()}>重新加载</button></main> : this.props.children }
}
try {
  const element = document.getElementById('root')
  if (!element) throw new Error('Missing root')
  const stop = syncAppearance(), root = createRoot(element)
  root.render(<ErrorBoundary><App /></ErrorBoundary>)
  const cleanup = () => { stop(); cancelRequests(); root.unmount() }
  window.addEventListener('pagehide', cleanup, { once: true })
  if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('pagehide', cleanup); cleanup() })
} catch {
  const fallback = document.createElement('main'); fallback.className = 'startup-fallback'; fallback.textContent = 'MCP 启动失败，请重新打开应用。'; document.body.replaceChildren(fallback)
}
