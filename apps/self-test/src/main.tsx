import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { SelfTestControl } from './self-test-control'
import { syncAppearance } from './lib/appearance'
import { disposeClient } from './lib/api'
import './theme.css'
import './styles.css'
function App() {
  useEffect(() => { const off = syncAppearance(); return () => { off(); disposeClient() } }, [])
  return <main className="app-shell"><div className="settings-content"><SelfTestControl /></div></main>
}
createRoot(document.getElementById('root')!).render(<App />)
