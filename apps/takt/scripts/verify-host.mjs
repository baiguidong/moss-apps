import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
const appRoot = fileURLToPath(new URL('..', import.meta.url)), repo = path.resolve(appRoot, '../..')
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const version = process.env.TAKT_VERSION || JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')).version
const output = path.join(repo, 'artifacts/moss.takt', version, 'verification')
const fromCore = file => import(pathToFileURL(path.join(core, file)))
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppExecutionHost } = await fromCore('ui/src/apps/app-execution-host.mjs')
const { installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { createExecutionProtocolDefinitions } = await fromCore('packages/app-sdk/src/execution/index.mjs')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-takt-host-')), requests = [], progress = [], checks = []
let dropEvents = false, runtime
const host = new AppExecutionHost({ directory: path.join(directory, 'tasks'), createSource: async context => {
  assert.equal(context.invocation.surface, 'app'); return { sessionId: 'takt-fixture', workspace: directory }
}, publishEvent: (target, protocol, name, data, options) => {
  if (dropEvents) return
  return runtime.withOwner(target.owner, () => runtime.publishHostEvent(target.appId, target.instanceId, protocol, name, data, options))
}, execute: async ({ input, controller, onProgress }) => {
  requests.push(input); onProgress({ tokens: 2, toolCalls: 0 })
  if (input.prompt.includes('WAIT_FOR_CANCEL')) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 20000); controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')) }, { once: true }) })
  if (input.prompt.includes('PAUSE_CHECK')) await new Promise(resolve => setTimeout(resolve, 500))
  await new Promise(resolve => setTimeout(resolve, 40))
  const value = input.outputSchema.properties.step ? { step: 1, reason: 'Fixture judgment' } : { content: '已验证本步骤，测试结果：42。' }
  return { value, tokens: 7, toolCalls: 0 }
} })
const protocols = createExecutionProtocolDefinitions()
runtime = new AppRuntimeHost({ rootDir: directory, nodeExecutable: process.execPath, requireTrustedPublisher: false, beforeAppDeactivation: appId => host.deactivate(appId), hostCapabilityOptions: { protocols } })
for (const def of protocols) for (const method of Object.keys(def.methods)) runtime.registerHostHandler(def.protocol, method, (input, context) => host.handle(def.protocol, method, input, context))
const wait = async (action, timeout = 20000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const result = await action(); if (result) return result; await new Promise(r => setTimeout(r, 100)) } throw new Error('Host test timed out') }
try {
  await runtime.initialize()
  await installAppArchive(runtime, path.join(repo, `artifacts/moss.takt/${version}/moss.takt-${version}.zip`))
  await runtime.setAppGrants('moss.takt', ['execution:read','execution:run','execution:cancel','tasks:read','tasks:write','tasks:cancel'])
  const instance = (await runtime.listInstances('moss.takt'))[0]
  const invoke = (name, input = {}) => runtime.invoke('moss.takt', instance.id, name, input, { invocation: { surface: 'app' } })
  const created = await invoke('takt_create', { title: 'Host 集成验证', yaml: await fs.readFile(path.join(appRoot, 'resources/example.yaml'), 'utf8') })
  assert.equal(created.revision, 1)
  const input = { workflowId: created.id, revision: 1, task: '验证分析与并行审查', submissionKey: 'host-submission' }
  const [run, duplicate] = await Promise.all([invoke('takt_run', input), invoke('takt_run', input)])
  assert.equal(run.id, duplicate.id)
  const completed = await wait(async () => { const value = await invoke('takt_read', { operation: 'run', runId: run.id }); return ['running','submitting'].includes(value.status) ? null : value })
  assert.equal(completed.status, 'completed', completed.error)
  assert.equal(completed.completedSteps, 5)
  assert.equal(requests.length, 4)
  assert.ok(completed.occurrences.some(n => n.nodeId === 'reviews/feasibility' && n.content.includes('42')))
  assert.ok(completed.occurrences.some(n => n.nodeId === 'reviews/verification' && n.content.includes('42')))
  assert.equal(new Set(requests.map(r => r.contextKey)).size, 4)
  assert.ok(completed.routes.some(r => r.nodeId === 'analyze' && r.target === 'reviews'))
  checks.push('真实 ZIP / Core Runtime / Tasks / Execution IPC；4 次 Agent 调用、5 个逻辑节点、双路并行、结果与实际路由')
  checks.push('并发重复提交复用 run；独立分支使用不同 contextKey')
  await assert.rejects(() => invoke('takt_run', { ...input, task: 'changed input' }))
  await invoke('takt_edit', { workflowId: created.id, baseRevision: 1, yaml: created.yaml.replace('max_steps: 12', 'max_steps: 10') })
  assert.equal((await invoke('takt_read', { operation: 'run', runId: run.id })).yaml, created.yaml)
  checks.push('编辑创建新修订，旧运行继续保留原始 YAML')
  const cancelling = await invoke('takt_run', { ...input, submissionKey: 'cancel', task: 'WAIT_FOR_CANCEL' })
  await wait(() => requests.length === 5)
  await invoke('takt_control', { operation: 'cancel', runId: cancelling.id })
  assert.equal((await invoke('takt_read', { operation: 'run', runId: cancelling.id })).status, 'cancelled')
  await new Promise(r => setTimeout(r, 200)); assert.equal(requests.length, 5)
  checks.push('取消实际 Host execution，停止下游调度')
  const hostCancelled = await invoke('takt_run', { ...input, submissionKey: 'host-cancel', task: 'WAIT_FOR_CANCEL' })
  await wait(() => requests.length === 6)
  host.cancelTask(host.tasks[hostCancelled.taskId], 'Host fixture cancellation')
  await wait(async () => (await invoke('takt_read', { operation: 'run', runId: hostCancelled.id })).status === 'cancelled')
  checks.push('Host 任务取消事件级联停止 App 引擎')
  dropEvents = true
  const recovered = await invoke('takt_run', { ...input, submissionKey: 'missed-event' })
  const recoveredResult = await wait(async () => { const r = await invoke('takt_read', { operation: 'run', runId: recovered.id }); return r.status === 'completed' ? r : null }, 30000)
  assert.equal(recoveredResult.completedSteps, 5); dropEvents = false
  checks.push('丢失推送后查询对账仍完成任务')
  await runtime.restartInstance('moss.takt', instance.id)
  assert.equal((await invoke('takt_read', { operation: 'run', runId: run.id })).completedSteps, 5)
  checks.push('Backend 重启后历史与节点结果仍可读取')
  const copy = await invoke('takt_copy', { workflowId: created.id, revision: 1, title: '独立副本' })
  assert.notEqual(copy.id, created.id)
  assert.equal(copy.yaml, created.yaml)
  assert.equal((await invoke('takt_read', { operation: 'revisions', workflowId: created.id })).items.length, 2)
  await invoke('takt_archive', { workflowId: copy.id, archived: true })
  assert.equal((await invoke('takt_read', { operation: 'list' })).items.some(f => f.id === copy.id), false)
  assert.equal((await invoke('takt_read', { operation: 'list', includeArchived: true })).items.some(f => f.id === copy.id), true)
  await assert.rejects(() => invoke('takt_run', { workflowId: copy.id, revision: 1, task: 'archived' }))
  await invoke('takt_archive', { workflowId: copy.id, archived: false })
  const resources = await invoke('composer.list', { query: '独立副本' })
  assert.equal(resources[0].ref.workflowId, copy.id)
  const resolved = await invoke('composer.resolve', { intent: 'use', ref: resources[0].ref })
  assert.deepEqual(resolved.ref, { workflowId: copy.id, revision: 1 })
  const beforePause = requests.length
  const paused = await invoke('takt_run', { workflowId: copy.id, revision: 1, task: 'PAUSE_CHECK', submissionKey: 'pause-check' })
  await wait(() => requests.length > beforePause)
  await invoke('takt_control', { operation: 'pause', runId: paused.id })
  await wait(async () => (await invoke('takt_read', { operation: 'run', runId: paused.id })).status === 'paused')
  const pausedCalls = requests.length
  await new Promise(resolve => setTimeout(resolve, 400)); assert.equal(requests.length, pausedCalls)
  await invoke('takt_control', { operation: 'input', runId: paused.id, text: 'SUPPLEMENT_MARKER' })
  await invoke('takt_control', { operation: 'resume', runId: paused.id })
  await wait(async () => (await invoke('takt_read', { operation: 'run', runId: paused.id })).status === 'completed')
  assert.ok(requests.slice(beforePause).some(r => r.prompt.includes('SUPPLEMENT_MARKER')))
  checks.push('复制/归档/恢复、修订历史及资源引用；暂停保持无新派发，继续完成，补充要求进入后续指令')
  const pausedRestart = await invoke('takt_run', { workflowId: copy.id, revision: 1, task: 'PAUSE_CHECK', submissionKey: 'pause-restart' })
  await invoke('takt_control', { operation: 'pause', runId: pausedRestart.id })
  await wait(async () => (await invoke('takt_read', { operation: 'run', runId: pausedRestart.id })).status === 'paused')
  await runtime.restartInstance('moss.takt', instance.id)
  const restarted = await invoke('takt_read', { operation: 'run', runId: pausedRestart.id })
  assert.ok(['interrupted','cancelled'].includes(restarted.status))
  await assert.rejects(() => invoke('takt_control', { operation: 'resume', runId: pausedRestart.id }))
  checks.push('暂停期间重启明确中断，不自动重放；只允许重跑')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'host-integration.json'), JSON.stringify({ passed: true, version, at: new Date().toISOString(), checks, calls: requests.length, sample: completed, limitations: ['执行结果由 fixture 提供；真实模型和桌面操作另行验证'] }, null, 2))
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2))
} catch (error) {
  console.error('Host verification failed:', error)
  if (runtime) { const instances = await runtime.listInstances('moss.takt').catch(() => []); if (instances[0]) console.error(await runtime.getLogs('moss.takt', instances[0].id, { limit: 12 })) }
  throw error
} finally { await runtime.shutdown(); await host.close(); await fs.rm(directory, { recursive: true, force: true }) }
