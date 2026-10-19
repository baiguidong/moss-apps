import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { AsyncResource } from 'node:async_hooks'
import { createTasksClient, createExecutionClient } from '@moss/app-sdk'
import { ExecutionWatcher, TaskChangesWatcher } from '@moss/app-sdk/execution'
import { readJsonRanges } from '@moss/app-sdk/results'
import { parseDefinition } from '../engine/definition.mjs'
import { digest, terminal } from './store.mjs'
const live = new Set(['running', 'pausing', 'paused'])

export class Runs {
  constructor(store, host, emit) {
    this.store = store; this.emit = emit; this.active = new Map(); this.submissions = new Map(); this.detached = new AsyncResource('takt-background')
    this.tasks = createTasksClient(host); this.executions = createExecutionClient(host)
    this.watcher = new ExecutionWatcher(this.executions)
    this.taskWatcher = new TaskChangesWatcher(this.tasks, task => this.onTask(task), { onReset: () => this.reconcile() })
    for (const run of store.runs.values()) if (live.has(run.status) || run.status === 'submitting') { run.status = 'interrupted'; run.error = 'Moss 或 App 已重启，上次运行或提交已中断，可按原修订重新运行'; run.endedAt = Date.now(); this.settleNodes(run); store.saveRun(run) }
    this.timer = setInterval(() => { void this.reconcile().catch(() => {}) }, 5000)
  }
  async start(input, requestId) {
    const key = input.submissionKey || requestId
    if (!key) throw new Error('缺少提交标识')
    const fingerprint = digest({ workflowId: input.workflowId, revision: input.revision, task: input.task })
    const prior = [...this.store.runs.values()].find(r => r.submissionKey === key)
    if (prior && prior.fingerprint !== fingerprint) throw new Error('同一提交标识不能用于不同运行参数')
    if (this.submissions.has(key)) return this.submissions.get(key)
    if (prior && prior.status !== 'submitting') return this.store.summary(prior)
    if (this.active.size + this.submissions.size >= 4) throw new Error('最多同时运行 4 个工作流')
    const operation = this.submit(input, key, fingerprint, prior)
    this.submissions.set(key, operation)
    try { return await operation } finally { this.submissions.delete(key) }
  }
  async submit(input, submissionKey, fingerprint, prior) {
    let run = prior
    if (!run) {
      const revision = this.store.revision(input.workflowId, input.revision)
      if (revision.archived) throw new Error('请先恢复已归档的工作流')
      parseDefinition(revision.yaml)
      run = { id: 'run_' + randomUUID(), workflowId: input.workflowId, revision: revision.revision, title: revision.title, yaml: revision.yaml, graph: revision.graph, task: input.task, status: 'submitting', createdAt: Date.now(), sequence: 0, occurrences: [], routes: [], executions: {}, events: [], submissionKey, fingerprint }
      this.store.saveRun(run)
    }
    let task
    try {
      task = await this.tasks.request('task.create', { idempotencyKey: run.id, title: run.title, route: '#/runs/' + run.id, limits: { maxConcurrency: 4, maxCalls: 128, maxDurationMs: 1800000, maxTokens: 500000 } })
    } catch (error) {
      Object.assign(run, { status: 'failed', error: `提交失败：${error.message}`, endedAt: Date.now() })
      this.store.saveRun(run); this.emit({ runId: run.id })
      throw error
    }
    Object.assign(run, { taskId: task.id, scopeRef: task.scopeRef, sessionId: task.sessionId, workspace: task.workspace, status: task.status === 'running' ? 'running' : 'interrupted' })
    this.store.saveRun(run)
    if (run.status === 'running') this.detached.runInAsyncScope(() => this.launch(run))
    this.emit({ runId: run.id }); return this.store.summary(run)
  }
  launch(run) {
    const directory = path.join(this.store.directory, 'engine', run.id)
    fs.mkdirSync(directory, { recursive: true })
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { execArgv: [], workerData: { yaml: run.yaml, task: run.task, directory, workspace: run.workspace }, env: { ...process.env, TAKT_CONFIG_DIR: path.join(directory, 'config') }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    const active = { worker, controller: new AbortController(), calls: new Map(), gates: new Set(), paused: false }; this.active.set(run.id, active)
    worker.on('message', message => {
      if (!live.has(run.status)) return
      if (message.type === 'event') { this.store.record(run, message.event); this.emit({ runId: run.id }) }
      if (message.type === 'call') void this.call(run, active, message).then(result => worker.postMessage({ type: 'result', id: message.id, result }), error => worker.postMessage({ type: 'result', id: message.id, error: error.message }))
      if (message.type === 'cancel-call') { const executionId = active.calls.get(message.id); if (executionId) void this.executions.request('execution.cancel', { executionId }).catch(() => {}) }
      if (message.type === 'outcome') void this.finish(run, message.outcome).catch(error => { run.syncError = error.message; this.store.saveRun(run) })
    })
    worker.on('error', error => void this.finish(run, { status: 'failed', error: error.message }).catch(() => {}))
    worker.on('exit', code => { if (this.active.has(run.id)) void this.finish(run, { status: 'failed', error: `运行进程意外退出 (${code})` }).catch(() => {}) })
  }
  async call(run, active, message) {
    const { nodeId, occurrenceId, step, phase, role, ...input } = message.input
    active.controller.signal.throwIfAborted()
    if (active.paused) await new Promise((resolve, reject) => {
      const release = () => { active.controller.signal.removeEventListener('abort', abort); active.gates.delete(release); resolve() }
      const abort = () => { active.gates.delete(release); reject(new Error('运行已停止')) }
      active.gates.add(release); active.controller.signal.addEventListener('abort', abort, { once: true })
    })
    active.controller.signal.throwIfAborted()
    if (run.supplements?.length) {
      input.prompt += '\n\n派发前补充要求（按时间顺序）：\n' + run.supplements.join('\n\n')
      if (input.prompt.length > 100000) throw new Error('补充要求使步骤输入超出 100000 字符限制')
    }
    const idempotencyKey = `call:${message.id}`
    run.executions[message.id] = { callId: message.id, nodeId, occurrenceId, step, phase, role, status: 'queued', input, idempotencyKey }
    this.store.saveRun(run)
    // Do not abort the request/lose its execution ID. Cancel a late acknowledgement explicitly.
    active.calls.set(message.id, null)
    try {
      const execution = await this.executions.request('execution.start', { scopeRef: run.scopeRef, idempotencyKey, ...input })
      active.calls.set(message.id, execution.id)
      if (active.controller.signal.aborted || !live.has(run.status)) { await this.executions.request('execution.cancel', { executionId: execution.id }); throw new Error('运行已停止') }
      const state = await this.watcher.wait(execution, active.controller.signal, state => {
        Object.assign(run.executions[message.id], { executionId: state.id, status: state.status, tokens: state.tokens, toolCalls: state.toolCalls })
        this.store.saveRun(run); this.emit({ runId: run.id })
      })
      if (state.status !== 'completed') throw new Error(state.error || state.status)
      if (!state.resultRef) throw new Error('Moss 没有返回结果引用')
      const value = await readJsonRanges((range, options) => this.executions.request('execution.result.read', { resultRef: state.resultRef, ...range }, options), { signal: active.controller.signal, maxBytes: 2_000_000 })
      Object.assign(run.executions[message.id], { status: 'completed', output: this.store.bound(JSON.stringify(value)), tokens: state.tokens, toolCalls: state.toolCalls })
      this.store.saveRun(run)
      return { value, tokens: state.tokens, toolCalls: state.toolCalls }
    } finally {
      active.calls.delete(message.id)
      if (active.paused && active.calls.size === 0 && live.has(run.status)) { run.status = 'paused'; this.store.saveRun(run); this.emit({ runId: run.id }) }
    }
  }
  settleNodes(run) { for (const occurrence of run.occurrences) if (occurrence.status === 'running') { occurrence.status = run.status === 'completed' ? 'completed' : run.status; occurrence.endedAt = Date.now() } }
  async finish(run, outcome) {
    if (!live.has(run.status)) return
    const active = this.active.get(run.id); this.active.delete(run.id)
    Object.assign(run, outcome, { endedAt: Date.now() }); this.settleNodes(run); this.store.saveRun(run)
    active?.controller.abort(); await active?.worker.terminate()
    // A failed branch may leave siblings running. Stop them before finishing the Host task.
    if (active) await Promise.allSettled([...active.calls.values()].filter(Boolean).map(executionId => this.executions.request('execution.cancel', { executionId })))
    await this.syncTask(run); this.emit({ runId: run.id })
  }
  async syncTask(run) {
    const task = await this.tasks.request('task.get', { taskId: run.taskId })
    if (terminal.has(task.status)) { run.status = task.status; run.hostFinished = true; this.settleNodes(run); this.store.saveRun(run); return }
    if (['cancelled', 'interrupted'].includes(run.status)) await this.tasks.request('task.cancel', { taskId: run.taskId, reason: run.error || '工作流已停止' })
    else await this.tasks.request('task.finish', { taskId: run.taskId, revision: task.revision, status: run.status === 'completed' ? 'completed' : 'failed', summary: (run.error || `完成 ${run.occurrences.length} 次节点执行`).slice(0, 2000), result: { runId: run.id, route: '#/runs/' + run.id, completedSteps: run.occurrences.filter(n => n.status === 'completed').length } })
    run.hostFinished = true; delete run.syncError; this.store.saveRun(run)
  }
  async onTask(task) {
    if (!terminal.has(task.status)) return
    const run = [...this.store.runs.values()].find(r => r.taskId === task.id && live.has(r.status))
    if (run) await this.finish(run, { status: task.status, error: task.error || (task.status === 'completed' ? undefined : 'Moss 已停止任务') })
  }
  async reconcile() {
    for (const run of this.store.runs.values()) {
      if (!run.taskId) continue
      try {
        if (live.has(run.status)) await this.onTask(await this.tasks.request('task.get', { taskId: run.taskId }))
        else if (terminal.has(run.status) && !run.hostFinished) await this.syncTask(run)
      } catch (error) { run.syncError = error.message }
    }
  }
  async cancel(id) { const run = this.store.getRun(id); if (live.has(run.status)) await this.finish(run, { status: 'cancelled', error: '用户停止运行' }); return this.store.summary(run) }
  pause(id) {
    const run = this.store.getRun(id), active = this.active.get(id)
    if (!active || !live.has(run.status)) throw new Error('当前运行不能暂停')
    active.paused = true; run.status = active.calls.size ? 'pausing' : 'paused'; this.store.saveRun(run); this.emit({ runId: id }); return this.store.summary(run)
  }
  resume(id) {
    const run = this.store.getRun(id), active = this.active.get(id)
    if (!active || !active.paused) throw new Error('这里只能继续当前 Moss 进程内暂停的运行；重启中断请重新运行')
    active.paused = false; run.status = 'running'; for (const release of [...active.gates]) release()
    this.store.saveRun(run); this.emit({ runId: id }); return this.store.summary(run)
  }
  addInput(id, text) {
    const run = this.store.getRun(id), active = this.active.get(id)
    if (!active || !live.has(run.status)) throw new Error('只能向进行中的运行补充要求')
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('补充要求必须为 1–8000 字符')
    const supplements = [...(run.supplements ?? []), text]
    if (supplements.join('\n').length > 16000) throw new Error('本次运行的补充要求累计不能超过 16000 字符')
    run.supplements = supplements
    active.worker.postMessage({ type: 'input', text })
    this.store.record(run, { type: 'user.input', timestamp: Date.now(), content: text }); this.emit({ runId: id }); return this.store.summary(run)
  }
  async close() {
    clearInterval(this.timer); this.taskWatcher.close()
    await Promise.allSettled([...this.active.keys()].map(id => this.finish(this.store.getRun(id), { status: 'interrupted', error: 'App 已停止，可重新运行' })))
    this.watcher.close(); this.detached.emitDestroy()
  }
}
