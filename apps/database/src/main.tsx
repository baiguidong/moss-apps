import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { syncAppearance } from './lib/appearance'
import { dispose } from './lib/api'
import './theme.css'
import './styles.css'
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <main className="workspace"><h1>数据库页面暂时无法显示</h1><button onClick={() => location.reload()}>重新加载</button></main> : this.props.children }
}
const root = createRoot(document.getElementById('root')!)
const stop = syncAppearance()
root.render(<ErrorBoundary><App/></ErrorBoundary>)
const cleanup = () => { stop(); dispose(); root.unmount() }
window.addEventListener('pagehide', cleanup, { once: true })
if (import.meta.hot) import.meta.hot.dispose(cleanup)
