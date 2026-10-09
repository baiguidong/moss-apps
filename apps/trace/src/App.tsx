import React from 'react'
import { TraceList } from './components/trace/TraceList'
import { TraceSession } from './components/trace/TraceSession'
import { TraceTargetContext } from './components/trace/TraceTarget'
function selectedSession() {
  const value = new URLSearchParams(location.hash.split('?')[1] || '').get('session')
  return value && /^[a-zA-Z0-9._-]{1,160}$/.test(value) ? value : null
}
export function App() {
  const [sessionId, setSessionId] = React.useState(selectedSession)
  React.useEffect(() => {
    const changed = () => setSessionId(selectedSession())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const open = (id: string | null) => { location.hash = id ? `/?session=${encodeURIComponent(id)}` : '/'; setSessionId(id) }
  return <TraceTargetContext.Provider value="local"><main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
    {sessionId ? <TraceSession key={sessionId} sessionId={sessionId} onBack={() => open(null)} /> : <TraceList onOpen={open} />}
  </main></TraceTargetContext.Provider>
}
