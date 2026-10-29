import { useEffect, useState } from 'react'
import { MemoryGraphView } from './components/memory-graph'
import { request } from './lib/api'
import './memory.css'

export function App() {
  const [memoryFile, setMemoryFile] = useState('')
  useEffect(() => {
    let active = true
    void request('servers.list').then(result => { if (active) setMemoryFile(result.memoryFile) }).catch(() => {})
    return () => { active = false }
  }, [])
  return <main className="app-shell" aria-label="记忆图谱"><div className="memory-workspace">
    <MemoryGraphView available />
    {memoryFile && <p className="memory-note">存储位置：{memoryFile}</p>}
  </div></main>
}
