import { version, archivePath, reportsDir, coreRoot, requireSignature, trustedPublishers } from './package-context.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const core = coreRoot
const fromCore = file => import(pathToFileURL(path.join(core, file)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppExecutionHost } = await fromCore('ui/src/apps/app-execution-host.mjs')
const { installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { createExecutionProtocolDefinitions } = await fromCore('packages/app-sdk/src/execution/index.mjs')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-package-'))
const protocols = createExecutionProtocolDefinitions()
let calls = 0
let dropExecutionEvents = false
const requests = [], acknowledgements = []
const host = new AppExecutionHost({ directory: path.join(directory, 'tasks'), createSource: async context => {
  assert.equal(context.invocation?.surface, 'app'); return { sessionId: 'fixture-session' }
}, publishEvent: (target, protocol, name, data, options) => {
  if (dropExecutionEvents && name === 'execution.changed') return
  return runtime.withOwner(target.owner, () => runtime.publishHostEvent(target.appId, target.instanceId, protocol, name, data, options))
    .then(() => { acknowledgements.push({ name, data }) })
}, execute: async ({ input, controller, onProgress }) => {
  calls++
  onProgress({ tokens: 5, toolCalls: 1, lastToolName: 'Read' })
  if (input.prompt.includes('EVENT_ONLY')) await new Promise(resolve => setTimeout(resolve, 1300))
  if (input.prompt.includes('WAIT')) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 10000); controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('stopped')) }, { once: true }) })
  return { value: { status: 'completed', output: { answer: 42 } }, tokens: 10, toolCalls: 1 }
} })
const runtime = new AppRuntimeHost({ rootDir: directory, nodeExecutable: process.execPath, trustedPublishers, requireTrustedPublisher: requireSignature, beforeAppDeactivation: appId => host.deactivate(appId), hostCapabilityOptions: { protocols } })
for (const def of protocols) for (const method of Object.keys(def.methods)) runtime.registerHostHandler(def.protocol, method, (input, context) => { requests.push({ method, input }); return host.handle(def.protocol, method, input, context) })
const definition = { version: 3, kind: 'state-machine', meta: { name: 'verify-flow', title: '验证工作流', description: '真实 App 包集成验证' }, graph: { entry: 'input', nodes: [
  { id: 'input', type: 'start', title: '输入', outputSchema: { type: 'object' } },
  { id: 'double', type: 'code', title: '数字翻倍', language: 'javascript', input: [{ target: ['value'], source: { kind: 'workflow-input', path: ['value'] } }], outputSchema: { type: 'number' }, script: 'return input.value * 2' },
  { id: 'output', type: 'end', title: '输出', inputSchema: {}, input: [{ target: [], source: { kind: 'node-output', nodeId: 'double' } }] },
], edges: [{ source: 'input', target: 'double' }, { source: 'double', target: 'output' }] } }
const waitFor = async get => { for (let i=0;i<150;i++) { const result = await get(); if (result) return result; await new Promise(r => setTimeout(r, 100)) } throw new Error('Timed out') }
try {
  await runtime.initialize()
  await installAppArchive(runtime, archivePath)
  await runtime.setAppGrants('moss.workflow', ['execution:read','execution:run','execution:cancel','tasks:read','tasks:write','tasks:cancel'])
  const instance = (await runtime.listInstances('moss.workflow'))[0]
  const invoke = (name, input = {}) => runtime.invoke('moss.workflow', instance.id, name, input, { invocation: { surface: 'app' } })
  const created = await invoke('catalog.create', { definition }); const id = created.record.id
  assert.equal(created.record.currentRevision, 1)
  await invoke('catalog.publish', { workflowId: id })
  const run = await invoke('run.start', { workflowId: id, args: { value: 21 } })
  const outcome = await waitFor(async () => { const r = await invoke('run.get', { runId: run.id }); return r.status === 'running' ? false : r })
  if (outcome.status !== 'completed') console.error(JSON.stringify(outcome), await runtime.getLogs('moss.workflow', instance.id, { limit: 50 })); assert.equal(outcome.status, 'completed', outcome.error); assert.equal(outcome.result, 42)
  assert.ok(outcome.events.some(event => event.type === 'workflow_node' && event.state === 'completed'))
  const agentDefinition = structuredClone(definition)
  agentDefinition.graph.nodes[1] = { id: 'double', type: 'agent', title: '结构化回答', prompt: 'EVENT_ONLY Return answer 42', outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'number' } } } }
  const requestStart = requests.length, agentStarted = Date.now()
  const agentRun = await invoke('run.start', { definition: agentDefinition })
  const agentOutcome = await waitFor(async () => { const r = await invoke('run.get', { runId: agentRun.id }); return r.status === 'running' ? false : r })
  assert.equal(agentOutcome.status, 'completed', agentOutcome.error); assert.equal(agentOutcome.result.answer, 42); assert.equal(calls, 1)
  assert.ok(Date.now() - agentStarted < 4000, 'completion should use push, not the 5-second fallback')
  assert.equal(requests.slice(requestStart).filter(r => r.method === 'execution.get').length, 1, 'no 400ms execution polling')
  assert.ok(acknowledgements.some(e => e.name === 'execution.changed' && e.data.taskId === agentRun.taskId && e.data.event.type === 'completed'))
  dropExecutionEvents = true
  const missed = await invoke('run.start', { definition: agentDefinition })
  const recovered = await waitFor(async () => { const r = await invoke('run.get', { runId: missed.id }); return r.status === 'running' ? false : r })
  assert.equal(recovered.status, 'completed', recovered.error)
  assert.equal(recovered.result.answer, 42)
  dropExecutionEvents = false
  agentDefinition.graph.nodes[1].prompt = 'WAIT then return answer'
  const waiting = await invoke('run.start', { definition: agentDefinition })
  await waitFor(() => calls === 3)
  const before = Date.now(); assert.ok((await invoke('run.list')).length >= 3); assert.ok(Date.now() - before < 2000)
  await invoke('run.cancel', { runId: waiting.id }); assert.equal((await invoke('run.get', { runId: waiting.id })).status, 'cancelled')
  const stoppedByHost = await invoke('run.start', { definition: agentDefinition })
  await waitFor(() => calls === 4)
  const hostStoppedAt = Date.now()
  host.cancelTask(host.tasks[stoppedByHost.taskId], 'Host stopped task')
  const stopped = await waitFor(async () => { const r = await invoke('run.get', { runId: stoppedByHost.id }); return r.status === 'cancelled' ? r : false })
  assert.equal(stopped.error, 'Host stopped task')
  assert.ok(Date.now() - hostStoppedAt < 2000, 'task cancellation should use push')
  await runtime.restartInstance('moss.workflow', instance.id)
  assert.equal((await invoke('run.get', { runId: run.id })).result, 42)
  await invoke('catalog.archive', { workflowId: id }); assert.equal((await invoke('catalog.get', { workflowId: id })).record.status, 'archived')
  await invoke('catalog.restore', { workflowId: id }); assert.equal((await invoke('catalog.get', { workflowId: id })).record.status, 'draft')
  const report = { package: `moss.workflow@${version}`, signatureRequired: requireSignature, tests: ['create/publish/code 21 → 42', 'typed SDK with real Core IPC', 'execution push without frequent polling', 'missed push recovers via query', 'Host task cancellation push', 'short action returns while running', 'cancellation', 'backend restart persists history', 'archive/restore'], passed: true, timestamp: new Date().toISOString() }
  const reports = reportsDir; await fs.mkdir(reports, { recursive: true }); await fs.writeFile(path.join(reports, 'package.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await runtime.shutdown(); await host.close(); await fs.rm(directory, { recursive: true, force: true }) }
