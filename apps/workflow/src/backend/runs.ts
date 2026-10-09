import { readJsonRanges } from '@moss/app-sdk/results'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID, createHash } from 'node:crypto'
import { updateRunSnapshot, readRunSnapshot } from './snapshot'
import { Resources } from './resources'
import { resolveDefinition, resolveChildren } from './validation'
import { Worker } from 'node:worker_threads'
import { AsyncResource } from 'node:async_hooks'
import { createTasksClient, createExecutionClient, type AppHostApi } from '@moss/app-sdk'
import { ExecutionWatcher, TaskChangesWatcher, DEFAULT_EXECUTION_REFRESH_MS as HOST_REFRESH_MS } from '@moss/app-sdk/execution'
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
export class RunManager {
  runs: Record<string, any> = {}
  active = new Map<
    string,
    {
      worker: Worker
      timer: ReturnType<typeof setInterval>
      executions: Map<string, string>
      controller: AbortController
    }
  >()
  resources: Resources
  starting = new Map<string, Promise<any>>()
  detached = new AsyncResource('workflow-background')
  completionTimer: ReturnType<typeof setInterval>
  private tasks: ReturnType<typeof createTasksClient>
  private executions: ReturnType<typeof createExecutionClient>
  private executionEvents: ExecutionWatcher
  private taskChanges: TaskChangesWatcher
  constructor(
    private directory: string,
    host: AppHostApi,
    private emit: (event: any) => void,
  ) {
    this.tasks = createTasksClient(host)
    this.executions = createExecutionClient(host)
    this.executionEvents = new ExecutionWatcher(this.executions)
    this.taskChanges = new TaskChangesWatcher(this.tasks, async task => {
      if (!terminal.has(task.status)) return
      for (const run of Object.values(this.runs)) {
        if (run.status === 'running' && run.taskId === task.id && run.attempt === task.attempt) {
          await this.cancel(run.id, task.error || 'Moss 已停止任务')
        }
      }
    }, { onReset: async () => {
      for (const run of Object.values(this.runs)) if (run.status === 'running' && run.taskId) {
        try {
          const task = await this.tasks.request('task.get', { taskId: run.taskId })
          if (terminal.has(task.status) && run.attempt === task.attempt) await this.cancel(run.id, task.error || 'Moss 已停止任务')
        } catch (error: any) {
          if (error.code !== 'APP_NOT_FOUND') throw error
          await this.cancel(run.id, 'Moss 任务已过期或不存在')
        }
      }
    } })
    fs.mkdirSync(directory, { recursive: true })
    this.resources = new Resources(path.join(directory, 'resources'))
    for (const name of fs
      .readdirSync(directory)
      .filter((name) => /^run_[a-f0-9-]+\.json$/.test(name))) {
      const run = JSON.parse(
        fs.readFileSync(path.join(directory, name), 'utf8'),
      )
      if (run.status === 'running') {
        run.status = 'interrupted'
        run.error = 'App 已重启，可恢复此运行'
      }
      this.runs[run.id] = run
    }
    this.completionTimer = setInterval(() => {
      for (const run of Object.values(this.runs))
        if (
          ['completed', 'failed', 'blocked'].includes(run.status) &&
          !run.hostFinished
        )
          void this.completeTask(run).catch(() => {})
    }, 5000)
  }
  save(run: any) {
    const file = path.join(this.directory, run.id + '.json')
    fs.writeFileSync(file + '.tmp', JSON.stringify(run), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
  }
  async events(input: any) {
    const run = this.get(input.runId), file = path.join(this.directory, run.id + '.events.jsonl')
    const events: any[] = [], limit = Math.max(1, Math.min(input.limit || 10, 10))
    if (!fs.existsSync(file)) return { events: run.events.filter((event:any)=>event.eventSequence > (input.afterSequence || 0)).slice(0,limit) }
    const stream = fs.createReadStream(file), lines = createInterface({ input: stream, crlfDelay: Infinity })
    try { for await (const line of lines) { try { const event = JSON.parse(line); if(event.eventSequence > (input.afterSequence || 0)) events.push(event) } catch {} if(events.length >= limit) break } }
    finally { lines.close(); stream.destroy() }
    return { events, earliestSequence: 1 }
  }
  snapshot(run: any) { return readRunSnapshot(run) }
  summary(run: any) {
    const { definition, nested, events, args, result, submissionKey, fingerprint, taskInput, stateSnapshot, ...rest } = run
    return { ...rest, result: this.resources.bound(result), eventCount: events.length }
  }
  get(runId: string) {
    const run = this.runs[runId]
    if (!run) throw new Error('运行不存在')
    return run
  }
  list(input: any = {}) {
    return Object.values(this.runs)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(input.offset ?? 0, (input.offset ?? 0) + Math.min(input.limit ?? 20, 20))
      .map((run) => this.summary(run))
  }
  async start(input: any, requestId?: string) {
    const submissionKey = input.submissionKey || requestId
    if (!submissionKey) throw new Error('Submission identity is required')
    const stable = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item)
    const fingerprint = createHash('sha256').update(stable({...input, submissionKey:undefined})).digest('hex')
    const prior = Object.values(this.runs).find(run => run.submissionKey === submissionKey)
    if (prior && prior.fingerprint !== fingerprint) throw new Error('Submission idempotency conflict: input changed')
    if (this.starting.has(submissionKey)) {
      await this.starting.get(submissionKey)
      return this.start(input, requestId)
    }
    if (prior && prior.status !== 'submitting') return this.summary(prior)
    const operation = this.submit(input, submissionKey, fingerprint, prior)
    this.starting.set(submissionKey, operation)
    try { return await operation } finally { this.starting.delete(submissionKey) }
  }
  async submit(input: any, submissionKey: string, fingerprint: string, prior?: any) {
    if (this.active.size >= 4) throw new Error('已有 4 个工作流运行中，请稍后再试')
    let run = prior
    if (!run) {
      const { definition, revision, workflowId } = await resolveDefinition(input)
      const nested = await resolveChildren(definition, input.cwd, workflowId)
      const id = 'run_' + randomUUID()
      run = { id, submissionKey, fingerprint, attempt:1, title:definition.meta.title, workflowId, revision,
        mode:input.mode ?? 'run', definition, args:input.args ?? {}, nested, status:'submitting', events:[], startedAt:Date.now(),
        taskInput: { idempotencyKey:id, title:definition.meta.title, route:'#/flow/runs/'+id,
          limits: {maxConcurrency:definition.limits?.maxConcurrency ?? definition.defaults?.concurrency ?? 4,
            maxCalls:definition.limits?.maxAgentCalls ?? 256, maxDurationMs:definition.limits?.maxDurationMs ?? 1_800_000} } }
      this.runs[id] = run
      this.save(run) // Persist intent before the host can accept it.
    }
    const task = await this.tasks.request('task.create', run.taskInput)
    Object.assign(run, {taskId:task.id, scopeRef:task.scopeRef, sessionId:task.sessionId, workspace:task.workspace,
      status:task.status === 'running' ? 'running' : 'interrupted'})
    this.save(run)
    if (run.status === 'running') this.detached.runInAsyncScope(() => this.launch(run))
    return this.summary(run)
  }
  launch(run: any) {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      execArgv: [],
      workerData: {
        ...run,
        runId: run.id,
        journal: path.join(this.directory, run.id + '.journal.jsonl'),
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    const executions = new Map<string, string>()
    const controller = new AbortController()
    let polling = false
    const isCurrent = () => this.active.get(run.id)?.controller === controller && run.status === 'running'
    const refreshTask = async () => {
      if (polling || !isCurrent()) return
      polling = true
      try {
        const task = await this.tasks.request('task.get', {
          taskId: run.taskId,
        }, { signal: controller.signal })
        if (isCurrent() && terminal.has(task.status) && task.attempt === run.attempt)
          await this.cancel(run.id, task.error || 'Moss 已停止任务')
      } catch (error) {
        if (isCurrent()) await this.cancel(run.id, String(error))
      } finally {
        polling = false
      }
    }
    const timer = setInterval(() => { void refreshTask() }, HOST_REFRESH_MS)
    this.active.set(run.id, { worker, timer, executions, controller })
    void refreshTask()
    worker.on('message', (message) => {
      if (message.type === 'event') {
        const event = { ...message.event, ...(message.event.output !== undefined ? { output: this.resources.bound(message.event.output, 2048) } : {}), ...(message.event.input !== undefined ? { input: this.resources.bound(message.event.input, 2048) } : {}), error: message.event.error?.slice(0,2000) };
        updateRunSnapshot(run, event)
        run.events.push({
          ...event,
          eventSequence: (run.sequence = (run.sequence ?? 0) + 1),
        })
        fs.appendFileSync(path.join(this.directory, run.id + '.events.jsonl'), JSON.stringify(run.events.at(-1)) + '\n', {mode:0o600})
        if (run.events.length > 4000)
          run.events.splice(0, run.events.length - 4000)
        this.save(run)
        this.emit({ runId: run.id, status: run.status })
      }
      if (message.type === 'agent')
        void this.agent(run, message, executions)
          .then(
            (result) =>
              worker.postMessage({
                type: 'agent-result',
                id: message.id,
                result,
              }),
            (error) =>
              worker.postMessage({
                type: 'agent-result',
                id: message.id,
                error: error.message,
              }),
          )
          .catch(() => {})
      if (message.type === 'agent-cancel') {
        const id = executions.get(message.id)
        if (id)
          void this.executions
            .request('execution.cancel', { executionId: id })
            .catch(() => {})
      }
      if (message.type === 'outcome')
        void this.finish(run, message.outcome).catch((error) => {
          run.notificationError = error.message
          this.save(run)
        })
    })
    worker.on('error', (error: Error) => {
      void this.finish(run, { status: 'failed', error: error.message }).catch(
        () => {},
      )
    })
    worker.on('exit', (code) => {
      if (run.status === 'running')
        void this.finish(run, {
          status: 'failed',
          error: `Worker exited (${code})`,
        }).catch(() => {})
    })
  }
  async agent(run: any, message: any, executions: Map<string, string>) {
    const signal = this.active.get(run.id)?.controller.signal
    if (!signal || signal.aborted || run.status !== 'running') throw new Error('工作流已停止')
    const input = message.input
    const execution = await this.executions.request('execution.start', {
      scopeRef: run.scopeRef,
      idempotencyKey: input.idempotencyKey,
      contextKey: input.contextKey,
      prompt: input.prompt,
      outputSchema: input.opts?.schema ?? {},
      ...(input.opts?.agentType ? { agentType: input.opts.agentType } : {}),
    }, { signal })
    executions.set(message.id, execution.id)
    try {
      const state = await this.executionEvents.wait(execution, signal, state => {
        this.active
          .get(run.id)
          ?.worker.postMessage({
            type: 'agent-progress',
            id: message.id,
            progress: {
              agentId: state.contextRef,
              tokens: state.tokens,
              toolCalls: state.toolCalls,
            },
          })
      })
      if (state.status !== 'completed')
        throw new Error(state.error || state.status)
      if (!state.resultRef) throw new Error('Moss 未返回执行结果引用')
      const value = await readJsonRanges((range, options) => this.executions.request('execution.result.read', { resultRef: state.resultRef!, ...range }, options), { signal })
      return {
        agentId: state.contextRef,
        value,
        tokens: state.tokens,
        toolCalls: state.toolCalls,
      }
    } finally {
      executions.delete(message.id)
    }
  }
  async finish(run: any, outcome: any) {
    if (run.status !== 'running') return
    const active = this.active.get(run.id)
    clearInterval(active?.timer)
    this.active.delete(run.id)
    active?.controller.abort(new Error('工作流已结束'))
    Object.assign(run, outcome, { endedAt: Date.now() })
    this.save(run)
    this.emit({ runId: run.id, status: run.status })
    await this.completeTask(run)
  }
  async completeTask(run: any) {
    const task = await this.tasks.request('task.get', {
      taskId: run.taskId,
    })
    if (!terminal.has(task.status))
      await this.tasks.request('task.finish', {
        taskId: run.taskId,
        revision: task.revision,
        status: run.status === 'completed' ? 'completed' : 'failed',
        summary:
          String(run.error || '').slice(0, 4000) ||
          (run.status === 'completed' ? '工作流已完成' : '工作流未完成'),
        ...(run.result !== undefined ? { result: this.resources.bound(run.result) } : {}),
      })
    if (['cancelled', 'interrupted'].includes(task.status) && task.attempt === run.attempt) {
      run.status = task.status
      run.error = task.error || 'Moss 已停止任务'
      this.emit({ runId: run.id, status: run.status })
    }
    run.hostFinished = true
    delete run.notificationError
    this.save(run)
  }
  async cancel(runId: string, reason = '用户停止运行') {
    const run = this.get(runId)
    if (run.status !== 'running') return this.summary(run)
    run.status = 'cancelled'
    run.error = reason
    run.endedAt = Date.now()
    this.save(run)
    const active = this.active.get(runId)
    this.active.delete(runId)
    clearInterval(active?.timer)
    active?.controller.abort(new Error(reason))
    await active?.worker.terminate()
    await this.tasks
      .request('task.cancel', { taskId: run.taskId, reason })
      .catch(() => {})
    this.emit({ runId, status: run.status })
    return this.summary(run)
  }
  async resume(runId: string) {
    const run = this.get(runId)
    if (!['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.status))
      throw new Error('当前状态不能恢复')
    if (this.active.size >= 4) throw new Error('运行数量已达上限')
    const task = await this.tasks.request('task.get', {
      taskId: run.taskId,
    })
    const next = await this.tasks.request('task.resume', {
      taskId: run.taskId,
      revision: task.revision,
    })
    Object.assign(run, {
      status: 'running',
      scopeRef: next.scopeRef,
      attempt: next.attempt,
      error: undefined,
      endedAt: undefined,
      hostFinished: false,
    })
    this.save(run)
    this.detached.runInAsyncScope(() => this.launch(run))
    return this.summary(run)
  }
  async close() {
    this.taskChanges.close()
    this.executionEvents.close()
    clearInterval(this.completionTimer)
    await Promise.all(
      [...this.active.keys()].map((id) => this.cancel(id, 'Execution watcher closed')),
    )
    this.detached.emitDestroy()
  }
}
