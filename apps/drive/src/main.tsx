import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createHostApi } from './lib/api'
import { createDemoApi } from './lib/demo'
import { DriveStore } from './lib/store'
import { syncAppearance } from './lib/appearance'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="app-shell startup-fallback"><h1>网盘暂时无法显示</h1><p>请重新打开网盘，正在进行的传输由 Moss 继续处理。</p><button className="primary" onClick={() => location.reload()}>重新加载</button></main>
    return this.props.children
  }
}

try {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing root')
  const stopAppearance = syncAppearance()
  const store = new DriveStore(window.mossApp ? createHostApi(window.mossApp) : createDemoApi())
  const reactRoot = createRoot(root)
  reactRoot.render(<ErrorBoundary><App store={store} /></ErrorBoundary>)
  const cleanup = () => { stopAppearance(); store.dispose(); reactRoot.unmount() }
  window.addEventListener('pagehide', cleanup, { once: true })
  if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('pagehide', cleanup); cleanup() })
} catch {
  const fallback = document.createElement('main')
  fallback.className = 'startup-fallback'
  fallback.textContent = '网盘启动失败，请重新打开应用。'
  document.body.replaceChildren(fallback)
}
