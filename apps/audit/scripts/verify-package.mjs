import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createLocalAuditService } from '../src/backend/service.mjs'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifest = JSON.parse(await fs.readFile(new URL('../app.moss.json', import.meta.url), 'utf8'))
const { id: appId, version } = manifest
const requireSignature = process.argv.includes('--require-signature')
const core = process.env.MOSS_CORE_ROOT || path.join(repoRoot, 'vendor/moss-core')
const { AppRuntimeHost } = await import(pathToFileURL(path.join(core, 'packages/app-runtime/src/index.mjs')))
const { installAppArchive } = await import(pathToFileURL(path.join(core, 'ui/src/apps/app-runtime.mjs')))
const { AppSessionSourceHost, createSessionSourceProtocolDefinition, SESSION_SOURCE_PROTOCOL } = await import(pathToFileURL(path.join(core, 'ui/src/apps/app-session-source-host.mjs')))
const { contractDefinition } = await import(pathToFileURL(path.join(core, 'packages/app-sdk/src/host/contracts.mjs')))
const zipPath = path.join(repoRoot, 'artifacts', appId, version, `${appId}-${version}.zip`)
const trustedPublishers = { moss: { keys: { 'release-1': await fs.readFile(path.join(repoRoot, 'publishers/moss/release-1.pem'), 'utf8') } } }
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-package-'))
const instanceId = `${appId}--default`
const sessions = [{ id: 'fixture-local', title: '审计迁移验证', agentMode: 'local', workspace: '/fixture', createdAt: 1, updatedAt: 2, history: [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'dangerous-1', name: 'Bash', input: { command: 'rm -rf /fixture/archive', api_key: 'DO_NOT_EXPORT' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'dangerous-1', content: 'done' }] } },
] }]
const notices = new Map(), opened = [], checks = []
let runtime
let exportCount = 0
const host = new AppSessionSourceHost({ mossHome: home, getRuntime: () => runtime, getSessions: () => sessions,
  getSessionSnapshot: session => { exportCount++; return session }, getSessionRevision: session => JSON.stringify([session.updatedAt, session.history.length]),
  openSession: input => opened.push(input) })
runtime = new AppRuntimeHost({ rootDir: home, nodeExecutable: process.execPath, trustedPublishers, requireTrustedPublisher: requireSignature,
  hostCapabilityOptions: { protocols: [createSessionSourceProtocolDefinition(), contractDefinition('moss.notifications/v1')] },
  beforeAppDeactivation: id => host.beforeDeactivation(id) })
for (const method of Object.keys(createSessionSourceProtocolDefinition().methods)) runtime.registerHostHandler(SESSION_SOURCE_PROTOCOL, method, (input, context) => host.handle(method, input, context))
runtime.registerHostHandler('moss.notifications/v1', 'publish', (input, context) => {
  notices.set(`${context.appId}:${input.id}`, input)
  return { delivered: true }
})
const invoke = async (name, input = {}) => {
  const result = await runtime.invoke(appId, instanceId, name, input, { timeoutMs: 120000 })
  if (!result.transfer) return result.value
  const chunks = []; let offset = 0
  while (offset < result.transfer.size) {
    const part = await runtime.invoke(appId, instanceId, 'result.read', { id: result.transfer.id, offset })
    chunks.push(Buffer.from(part.data, 'base64')); offset = part.nextOffset
  }
  await runtime.invoke(appId, instanceId, 'result.release', { id: result.transfer.id })
  return JSON.parse(Buffer.concat(chunks).toString())
}
try {
  const seeded = createLocalAuditService({ dbPath: path.join(runtime.dataDir, appId, 'instances', instanceId, 'audit.db'), getLocalSessions: () => sessions })
  await seeded.runAudit()
  seeded.updateFinding({ id: seeded.getDashboard().findings[0].id, status: 'resolved' })
  seeded.close()
  await runtime.initialize()
  await installAppArchive(runtime, zipPath)
  let dashboard = await invoke('dashboard.get')
  assert.equal(dashboard.findings[0].status, 'resolved')
  assert.ok(!JSON.stringify(dashboard).includes('DO_NOT_EXPORT'))
  checks.push('actual ZIP install, Node Backend, existing decisions and redaction')
  const firstExportCount = exportCount
  await invoke('dashboard.get')
  assert.equal(exportCount, firstExportCount)
  sessions[0].history.push({ type: 'user', message: { content: '新消息' } })
  sessions[0].updatedAt++
  dashboard = await invoke('dashboard.get')
  assert.equal(exportCount, firstExportCount + 1)
  checks.push('unchanged scans avoid export; changed session exports once')
  const finding = dashboard.findings[0]
  await invoke('finding.update', { id: finding.id, status: 'acknowledged' })
  await runtime.restartInstance(appId, instanceId)
  dashboard = await invoke('dashboard.get')
  assert.equal(dashboard.findings[0].status, 'acknowledged')
  checks.push('restart retains database and decisions')
  await invoke('findings.update', { ids: [finding.id], status: 'open' })
  await invoke('audit.run')
  await invoke('audit.run')
  assert.equal(notices.size, 1)
  checks.push('full audit, batch decisions, idempotent high severity notifications')
  const ticket = await host.recordEvent({ sessionId: 'fixture-local', eventType: 'turn_reverted', details: { status: 'started' }, sourceSession: { id: 'fixture-local', history: [{ type: 'user', prompt: '完整历史'.repeat(100000) }] } })
  await host.updateEvent(ticket, { status: 'completed' })
  await invoke('dashboard.get')
  const event = await invoke('event.get', { id: ticket[0].id })
  assert.equal(event.details.status, 'completed')
  assert.equal(event.history[0].prompt.length, 400000)
  await runtime.restartInstance(appId, instanceId)
  dashboard = await invoke('dashboard.get')
  assert.equal(dashboard.events.filter(e => e.id === ticket[0].id).length, 1)
  checks.push('rewind event import, multi-chunk full history, idempotent replay')
  await invoke('session.open', { sessionId: 'fixture-local', toolUseId: 'dangerous-1' })
  assert.equal(opened[0].toolUseId, 'dangerous-1')
  await assert.rejects(invoke('session.open', { sessionId: 'nonexistent' }))
  await assert.rejects(invoke('rule.update', { id: 'destructive-command', severity: 'invalid' }))
  checks.push('navigation and action schema validation')
  await runtime.setAppEnabled(appId, false)
  await assert.rejects(invoke('dashboard.get'))
  assert.equal(await host.recordEvent({ sessionId: 'fixture-local' }), null)
  await runtime.setAppEnabled(appId, true)
  assert.ok((await invoke('dashboard.get')).sessions.length)
  await runtime.setAppGrants(appId, ['session-source:open', 'notifications:publish'])
  await assert.rejects(invoke('dashboard.get'))
  await runtime.setAppGrants(appId, ['session-source:read', 'session-source:open', 'notifications:publish'])
  assert.ok((await invoke('dashboard.get')).sessions.length)
  checks.push('disable, enable, grant revocation and recovery')
  const reportDir = path.join(repoRoot, 'artifacts', appId, 'verification', version)
  await fs.mkdir(reportDir, { recursive: true })
  const report = { appId, version, nodeVersion: process.version, requireSignature, passed: checks.length, checks, zipPath, sha256: createHash('sha256').update(await fs.readFile(zipPath)).digest('hex'), testedAt: new Date().toISOString() }
  await fs.writeFile(path.join(reportDir, 'integration.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await host.close(); await runtime.shutdown(); await fs.rm(home, { recursive: true, force: true }) }
