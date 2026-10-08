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
const { AppAuditHost, createAuditProtocolDefinition, AUDIT_PROTOCOL } = await import(pathToFileURL(path.join(core, 'ui/src/apps/app-audit-host.mjs')))
const zipPath = path.join(repoRoot, 'artifacts', appId, version, `${appId}-${version}.zip`)
const trustedPublishers = { moss: { keys: { 'release-1': await fs.readFile(path.join(repoRoot, 'publishers/moss/release-1.pem'), 'utf8') } } }
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-package-'))
const instanceId = `${appId}--default`
const sessions = [{ id: 'fixture-local', title: '审计迁移验证', agentMode: 'local', workspace: '/fixture', createdAt: 1, updatedAt: 2, history: [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'dangerous-1', name: 'Bash', input: { command: 'rm -rf /fixture/archive', api_key: 'DO_NOT_EXPORT' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'dangerous-1', content: 'done' }] } },
] }]
const legacy = createLocalAuditService({ dbPath: path.join(home, 'audit.db'), getLocalSessions: () => sessions })
await legacy.runAudit()
legacy.updateFinding({ id: legacy.getDashboard().findings[0].id, status: 'resolved' })
legacy.close()
const notices = new Map(), opened = [], checks = []
let runtime
const host = new AppAuditHost({ mossHome: home, getRuntime: () => runtime, getSessions: () => sessions,
  openSession: input => opened.push(input), notify: (input, options) => notices.set(options.id, input) })
runtime = new AppRuntimeHost({ rootDir: home, nodeExecutable: process.execPath, trustedPublishers, requireTrustedPublisher: requireSignature,
  hostCapabilityOptions: { protocols: [createAuditProtocolDefinition()] },
  beforeAppDeactivation: id => host.beforeDeactivation(id) })
for (const method of Object.keys(createAuditProtocolDefinition().methods)) runtime.registerHostHandler(AUDIT_PROTOCOL, method, (input, context) => host.handle(method, input, context))
runtime.events.on('event', event => { if (event.appId === appId && ['installation-changed', 'instance-changed'].includes(event.type)) host.refresh() })
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
  await runtime.initialize()
  await installAppArchive(runtime, zipPath)
  let dashboard = await invoke('dashboard.get')
  assert.equal(dashboard.findings[0].status, 'resolved')
  assert.ok(!JSON.stringify(dashboard).includes('DO_NOT_EXPORT'))
  checks.push('actual ZIP install, Node Backend, legacy decisions and redaction')
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
  const event = await invoke('event.get', { id: ticket.id })
  assert.equal(event.details.status, 'completed')
  assert.equal(event.history[0].prompt.length, 400000)
  await runtime.restartInstance(appId, instanceId)
  dashboard = await invoke('dashboard.get')
  assert.equal(dashboard.events.filter(e => e.id === ticket.id).length, 1)
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
  await runtime.setAppGrants(appId, ['audit:navigate', 'audit:notify'])
  await assert.rejects(invoke('dashboard.get'))
  await runtime.setAppGrants(appId, ['audit:read', 'audit:navigate', 'audit:notify'])
  assert.ok((await invoke('dashboard.get')).sessions.length)
  checks.push('disable, enable, grant revocation and recovery')
  const reportDir = path.join(repoRoot, 'artifacts', appId, 'verification', version)
  await fs.mkdir(reportDir, { recursive: true })
  const report = { appId, version, nodeVersion: process.version, requireSignature, passed: checks.length, checks, zipPath, sha256: createHash('sha256').update(await fs.readFile(zipPath)).digest('hex'), testedAt: new Date().toISOString() }
  await fs.writeFile(path.join(reportDir, 'integration.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await host.close(); await runtime.shutdown(); await fs.rm(home, { recursive: true, force: true }) }
