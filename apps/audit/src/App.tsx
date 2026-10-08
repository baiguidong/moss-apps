import React from 'react'
import { AuditView } from './components/audit-view'
import { auditApi } from './lib/api'

export function App() {
  const [notice, setNotice] = React.useState('')
  const open = React.useCallback((sessionId: string, toolUseId?: string) => {
    void auditApi.openSession(sessionId, toolUseId).catch(error => setNotice(error.message))
  }, [])
  const report = React.useCallback((error: { title: string; message: string }) => setNotice(`${error.title}：${error.message}`), [])
  return <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
    {notice && <div role="status" className="flex items-center justify-between border-b bg-muted px-5 py-2 text-sm">
      <span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示" className="px-2">×</button>
    </div>}
    <div className="min-h-0 flex-1"><AuditView onOpenSession={open} onLocateTool={open} onNotice={setNotice} onError={report} /></div>
  </main>
}
