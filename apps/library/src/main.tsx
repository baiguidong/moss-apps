import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createHostApi, createDemoApi } from './lib/api'
import { syncAppearance } from './lib/appearance'
import './styles.css'
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <main className="empty"><h1>知识库暂时无法显示</h1><button onClick={() => location.reload()}>重新加载</button></main> : this.props.children }
}
const stop = syncAppearance()
const root = createRoot(document.getElementById('root')!)
root.render(<ErrorBoundary><App api={window.mossApp ? createHostApi(window.mossApp) : createDemoApi()} /></ErrorBoundary>)
window.addEventListener('pagehide', stop, { once: true })
