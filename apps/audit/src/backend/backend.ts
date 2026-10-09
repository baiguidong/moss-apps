import { AppBackendClient } from '@moss/app-sdk'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createLocalAuditService } from './service.mjs'
import { createResultTransport } from './transport'

const protocol = 'moss.audit/v1'
export function createAuditBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  let service: ReturnType<typeof createLocalAuditService> | undefined
  let sessions: any[] = []
  let dataDir = ''
  let timer: ReturnType<typeof setInterval> | undefined
  let initialTimer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let closed = false
  let scanPending = false
  const imported = new Map<string, string>()
  const transfer = createResultTransport()
  const serialized = <T,>(operation: () => Promise<T>): Promise<T> => {
    const task = queue.then(() => { if (closed) throw new Error('审计 App 正在停止。'); return operation() })
    queue = task.catch(() => {})
    return task
  }
  const backend = new AppBackendClient({ ...options,
    onInitialize: async (context: { dataDir: string }) => {
      dataDir = context.dataDir
      // Readiness is local. Host startup can still be completing; failures retry without exiting.
      const scan = () => {
        if (scanPending || closed) return
        scanPending = true
        void serialized(async () => {
        await capture()
        await service!.runIncrementalAudit()
        await deliverAlerts()
      }).then(() => backend.status('ready'), error => backend.status('degraded', { error: error.message }))
          .finally(() => { scanPending = false })
      }
      initialTimer = setTimeout(scan, 100)
      timer = setInterval(scan, 30_000)
    },
    onShutdown: async () => {
      closed = true
      clearTimeout(initialTimer)
      clearInterval(timer)
      await queue
      service?.close()
      transfer.close()
    },
  })
  async function capture() {
    await backend.host.request(protocol, 'source.capture', {}, { timeoutMs: 120_000 })
    const directory = dataDir
    const source = JSON.parse(await fs.readFile(path.join(directory, 'source/snapshot.json'), 'utf8'))
    if (source.schemaVersion !== 1 || !Array.isArray(source.sessions)) throw new Error('不支持的会话快照版本。')
    sessions = source.sessions.map((session: any) => ({ ...session, mossHome: source.mossHome }))
    service ??= createLocalAuditService({ dbPath: path.join(directory, 'audit.db'), getLocalSessions: () => sessions,
      onChanged: (event: any) => { const { alerts: _alerts, ...change } = event; backend.emit('audit.changed', change) } })
    for (const entry of await fs.readdir(path.join(directory, 'events'), { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9-]+\.json$/.test(entry.name)) continue
      const raw = await fs.readFile(path.join(directory, 'events', entry.name), 'utf8')
      const hash = createHash('sha256').update(raw).digest('hex')
      if (imported.get(entry.name) === hash) continue
      const event = JSON.parse(raw)
      if (event.schemaVersion !== 1 || `${event.id}.json` !== entry.name) throw new Error('无效的审计操作事件。')
      service.recordEvent(event)
      imported.set(entry.name, hash)
    }
  }
  async function deliverAlerts() {
    for (const alert of service!.listPendingAlerts()) {
      await backend.host.request(protocol, 'notification.publish', {
        id: String(alert.fingerprint),
        severity: alert.severity === 'critical' ? 'error' : 'warning',
        title: String(alert.title || '审计发现').slice(0, 240),
        message: [alert.ruleName, alert.sessionTitle, alert.toolName].filter(Boolean).join(' · ').slice(0, 4000),
        ...(alert.detail ? { details: String(alert.detail).slice(0, 16000) } : {}),
      })
      service!.markFindingsReported({ fingerprints: [alert.fingerprint] })
    }
  }
  for (const [name, action] of Object.entries({
    'dashboard.get': async () => { await service!.runIncrementalAudit(); return service!.getDashboard() },
    'event.get': async (input: any) => service!.getEvent(input),
    'audit.run': async (input: any) => service!.runAudit(input),
    'rule.update': async (input: any) => service!.updateRule(input),
    'finding.update': async (input: any) => service!.updateFinding(input),
    'findings.update': async (input: any) => service!.updateFindings(input),
  })) backend.registerAction(name, (input: any) => serialized(async () => {
    await capture()
    const result = await action(input)
    // An unavailable notification grant must not turn a completed scan into a failed action.
    await deliverAlerts().catch(error => backend.status('degraded', { error: error.message }))
    return transfer.pack(result)
  }))
  backend.registerAction('session.open', async (input: unknown) => transfer.pack(await backend.host.request(protocol, 'session.open', input as { sessionId: string; toolUseId?: string })))
  backend.registerAction('status.get', () => transfer.pack({ ready: Boolean(service), scanning: service?.isRunning() || false }))
  backend.registerAction('result.read', (input: any) => transfer.read(input))
  backend.registerAction('result.release', (input: any) => transfer.release(input.id))
  return backend
}
