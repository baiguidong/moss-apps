const logForDebugging = (message: string) => console.warn(message)
import { describeThrown } from './errors.js'
import {
  WORKFLOW_AGENT_CAP_MESSAGE,
  WORKFLOW_AGENT_STALL_MS,
  WORKFLOW_LABEL_MAX_CHARS,
  WORKFLOW_MAX_AGENTS,
  WORKFLOW_PREVIEW_MAX_CHARS,
  getWorkflowConcurrency,
} from './constants.js'
import {
  WorkflowJournal,
  type WorkflowJournalSnapshot,
} from './journal.js'
import { createLimiter, type Limiter } from './limiter.js'
import {
  createWorkflowAgentController,
  runWorkflowAgent,
  type WorkflowAgentRunParams,
  type WorkflowAgentRunResult,
} from './agent-executor.js'
import type {
  WorkflowAgentEvent,
  WorkflowAgentInvocation,
  WorkflowAgentOptions,
  WorkflowProgressEvent,
} from './types.js'

export class WorkflowAgentCapError extends Error {
  constructor(limit = WORKFLOW_MAX_AGENTS) {
    super(limit === WORKFLOW_MAX_AGENTS
      ? WORKFLOW_AGENT_CAP_MESSAGE
      : `Workflow Agent node invocation cap reached (${limit}). Reduce foreach input size or loop iterations before resuming.`)
    this.name = 'WorkflowAgentCapError'
  }
}

export class WorkflowBudgetExceededError extends Error {
  constructor(spent: number, total: number) {
    super(
      `Workflow token budget exceeded (${spent.toLocaleString()} / ${total.toLocaleString()} output tokens). ` +
        'Stopping further Agent nodes. In-flight agents will complete; their results are preserved.',
    )
    this.name = 'WorkflowBudgetExceededError'
  }
}

export type WorkflowHarnessParams = {
  runId: string
  workflowName: string
  emit: (event: WorkflowProgressEvent) => void
  tokenBudget?: { total: number | null; getTurnSpent: () => number }
  journal?: WorkflowJournal
  journalSnapshot?: WorkflowJournalSnapshot
  onAgentController: (
    agentKey: string,
    controller: AbortController | undefined,
  ) => void
  abortSignal?: AbortSignal
  runAgentImpl?: (
    params: WorkflowAgentRunParams,
  ) => Promise<WorkflowAgentRunResult>
  shared?: WorkflowSharedCounters
}

export type WorkflowSharedCounters = {
  limiter: Limiter
  nextAgentIndex: () => number
  getAgentCount: () => number
  getAgentLimit: () => number
  resolvePhase: (
    workflowName: string,
    title: string,
    emit: (event: WorkflowProgressEvent) => void,
    nodeId?: string,
  ) => number
  recordFailure: (message: string) => void
  getFailures: () => string[]
}

export function createWorkflowSharedCounters(
  concurrency = getWorkflowConcurrency(),
  maxAgents = WORKFLOW_MAX_AGENTS,
): WorkflowSharedCounters {
  let agentCount = 0
  let phaseCount = 0
  const phaseIndexByKey = new Map<string, number>()
  const failures: string[] = []
  return {
    limiter: createLimiter(Math.max(1, Math.min(getWorkflowConcurrency(), concurrency))),
    nextAgentIndex: () => ++agentCount,
    getAgentCount: () => agentCount,
    getAgentLimit: () => Math.max(1, Math.min(WORKFLOW_MAX_AGENTS, maxAgents)),
    resolvePhase: (workflowName, title, emit, nodeId) => {
      const key = `${workflowName}\0${nodeId ?? title}`
      const existing = phaseIndexByKey.get(key)
      if (existing !== undefined) return existing
      const index = ++phaseCount
      phaseIndexByKey.set(key, index)
      emit({
        type: 'workflow_phase',
        index,
        ...(nodeId ? { nodeId } : {}),
        title,
        kind: 'definition',
      })
      return index
    },
    recordFailure: message => failures.push(message),
    getFailures: () => failures,
  }
}

export type WorkflowHarness = {
  agent: (
    prompt: string,
    opts: WorkflowAgentOptions,
    invocation: WorkflowAgentInvocation,
  ) => Promise<unknown>
  phase: (title: string, nodeId?: string) => void
  getAgentCount: () => number
  getFailures: () => string[]
  recordFailure: (message: string) => void
}

/** Host bridge for Agent nodes in a structured workflow. */
export function createWorkflowHarness(
  params: WorkflowHarnessParams,
): WorkflowHarness {
  const {
    runId,
    workflowName,
    emit,
    tokenBudget,
    journal,
    journalSnapshot,
    onAgentController,
    abortSignal,
    runAgentImpl = runWorkflowAgent,
    shared = createWorkflowSharedCounters(),
  } = params

  let capReported = false
  let budgetReported = false
  const agentSessions = new Map<string, {
    index: number
    agentId?: string
    conversationMessages?: WorkflowAgentRunResult['conversationMessages']
  }>()

  const assertAgentCap = (): void => {
    const limit = shared.getAgentLimit()
    if (shared.getAgentCount() < limit) return
    if (!capReported) {
      capReported = true
      logForDebugging(`Workflow ${runId} hit the ${limit}-agent cap`)
    }
    throw new WorkflowAgentCapError(limit)
  }

  const assertBudget = (): void => {
    const total = tokenBudget?.total
    if (total == null || total <= 0) return
    const spent = tokenBudget!.getTurnSpent()
    if (spent < total) return
    if (!budgetReported) {
      budgetReported = true
      logForDebugging(`Workflow ${runId} exhausted its ${total} token budget`)
    }
    throw new WorkflowBudgetExceededError(spent, total)
  }

  const agent = async (
    prompt: string,
    rawOpts: WorkflowAgentOptions,
    invocation: WorkflowAgentInvocation,
  ): Promise<unknown> => {
    if (abortSignal?.aborted) throw new Error('Workflow aborted')
    assertBudget()

    const opts = { ...rawOpts }
    let session = agentSessions.get(invocation.sessionKey)
    if (!session) {
      assertAgentCap()
      session = { index: shared.nextAgentIndex() }
      agentSessions.set(invocation.sessionKey, session)
    }
    const index = session.index
    const label = deriveLabel(prompt, opts.label)
    const phaseTitle = invocation.phaseTitle ?? opts.phase
    const phaseIndex = phaseTitle
      ? shared.resolvePhase(workflowName, phaseTitle, emit)
      : undefined
    const promptPreview = clip(prompt, WORKFLOW_PREVIEW_MAX_CHARS)

    const cached = journalSnapshot?.results.get(invocation.cacheKey)
    if (cached !== undefined) {
      session.agentId = cached.agentId
      const now = Date.now()
      emit({
        type: 'workflow_agent',
        index,
        nodeId: invocation.nodeId,
        instanceId: invocation.instanceId,
        ...(invocation.parentInstanceId
          ? { parentInstanceId: invocation.parentInstanceId }
          : {}),
        label,
        state: 'done',
        phaseIndex,
        phaseTitle,
        agentId: cached.agentId,
        startedAt: now,
        lastProgressAt: now,
        cached: true,
        promptPreview,
        resultPreview: clip(toDisplayString(cached.result), WORKFLOW_PREVIEW_MAX_CHARS),
      })
      return cached.result
    }

    const queuedAt = Date.now()
    const baseEvent: WorkflowAgentEvent = {
      type: 'workflow_agent',
      index,
      nodeId: invocation.nodeId,
      instanceId: invocation.instanceId,
      ...(invocation.parentInstanceId
        ? { parentInstanceId: invocation.parentInstanceId }
        : {}),
      label,
      state: 'start',
      phaseIndex,
      phaseTitle,
      queuedAt,
      lastProgressAt: queuedAt,
      promptPreview,
      ...(session.agentId ? { agentId: session.agentId } : {}),
      ...(opts.agentType ? { agentType: opts.agentType } : {}),
    }
    emit(baseEvent)

    const agentKey = `${runId}-${index}`
    return shared.limiter(async () => {
      if (abortSignal?.aborted) throw new Error('Workflow aborted')
      assertBudget()
      const overallStartedAt = Date.now()
      let priorTokens = 0
      let priorToolCalls = 0

      while (true) {
        const controller = createWorkflowAgentController(abortSignal)
        onAgentController(agentKey, controller)
        const timeout = invocation.timeoutMs
          ? setTimeout(() => controller.abort(new Error(`${label}: timed out after ${invocation.timeoutMs}ms`)), invocation.timeoutMs)
          : undefined
        timeout?.unref?.()
        let tokens = 0
        let toolCalls = 0
        let agentId: string | undefined
        let lastProgressAt = overallStartedAt
        const stallMs = opts.stallMs ?? WORKFLOW_AGENT_STALL_MS
        const stallTimer = setInterval(() => {
          if (Date.now() - lastProgressAt < stallMs) return
          emit({
            ...baseEvent,
            state: 'progress',
            startedAt: overallStartedAt,
            lastProgressAt,
            tokens: priorTokens + tokens,
            toolCalls: priorToolCalls + toolCalls,
            agentId,
          })
        }, Math.max(5_000, Math.floor(stallMs / 2)))
        stallTimer.unref?.()

        emit({
          ...baseEvent,
          state: 'progress',
          startedAt: overallStartedAt,
          lastProgressAt,
          tokens: priorTokens,
          toolCalls: priorToolCalls,
        })

        try {
          const result = await runAgentImpl({
            prompt,
            opts,
            runId,
            contextKey: invocation.sessionKey,
            idempotencyKey: invocation.cacheKey,
            workflow: {
              runId,
              name: workflowName,
              phaseIndex: phaseIndex ?? 0,
              ...(phaseTitle ? { phaseTitle } : {}),
              agentIndex: index,
            },
            abortController: controller,
            ...(session?.conversationMessages && session.agentId
              ? { conversation: { agentId: session.agentId, messages: session.conversationMessages } }
              : session?.agentId
                ? { resumeAgentId: session.agentId }
                : {}),
            onAgentId: id => {
              agentId = id
              void journal?.append({
                type: 'started',
                key: invocation.cacheKey,
                agentId: id,
              }).catch(error =>
                logForDebugging(`workflow journal started-append failed: ${error}`),
              )
            },
            onProgress: progress => {
              tokens = progress.tokens
              toolCalls = progress.toolCalls
              lastProgressAt = Date.now()
              emit({
                ...baseEvent,
                state: 'progress',
                startedAt: overallStartedAt,
                lastProgressAt,
                tokens: priorTokens + tokens,
                toolCalls: priorToolCalls + toolCalls,
                agentId,
                ...(progress.lastToolName
                  ? { lastToolName: progress.lastToolName }
                  : {}),
              })
            },
          })

          session!.agentId = result.agentId
          session!.conversationMessages = result.conversationMessages

          emit({
            ...baseEvent,
            state: 'done',
            agentId: result.agentId,
            startedAt: overallStartedAt,
            lastProgressAt: Date.now(),
            durationMs: Date.now() - overallStartedAt,
            tokens: priorTokens + result.tokens,
            toolCalls: priorToolCalls + result.toolCalls,
            resultPreview: clip(toDisplayString(result.value), WORKFLOW_PREVIEW_MAX_CHARS),
          })
          void journal?.append({
            type: 'result',
            key: invocation.cacheKey,
            agentId: result.agentId,
            result: result.value,
          }).catch(error =>
            logForDebugging(`workflow journal result-append failed: ${error}`),
          )
          return result.value
        } catch (error) {
          const reason = describeThrown(controller.signal.reason)
          const skipped = reason.includes('user-skip')
          const retry = reason.includes('user-retry')
          if (abortSignal?.aborted) throw new Error('Workflow aborted')
          if (retry) {
            priorTokens += tokens
            priorToolCalls += toolCalls
            emit({
              type: 'workflow_log',
              nodeId: invocation.nodeId,
              instanceId: invocation.instanceId,
              message: `Restarting agent "${label}" at user request`,
            })
            continue
          }
          const message = skipped ? 'skipped by user' : describeThrown(error)
          emit({
            ...baseEvent,
            state: 'error',
            agentId,
            startedAt: overallStartedAt,
            lastProgressAt: Date.now(),
            durationMs: Date.now() - overallStartedAt,
            tokens: priorTokens + tokens,
            toolCalls: priorToolCalls + toolCalls,
            error: message,
            ...(skipped ? { skipped: true } : {}),
          })
          if (skipped) return null
          throw error
        } finally {
          if (timeout) clearTimeout(timeout)
          clearInterval(stallTimer)
          if (!controller.signal.aborted) controller.abort()
          onAgentController(agentKey, undefined)
        }
      }
    })
  }

  const phase = (title: string, nodeId?: string): void => {
    if (title) shared.resolvePhase(workflowName, title, emit, nodeId)
  }

  return {
    agent,
    phase,
    getAgentCount: shared.getAgentCount,
    getFailures: shared.getFailures,
    recordFailure: shared.recordFailure,
  }
}

function deriveLabel(prompt: string, explicit: string | undefined): string {
  const normalized = (explicit ?? prompt).replace(/\s+/g, ' ').trim()
  if (normalized === '') return 'agent'
  return normalized.length > WORKFLOW_LABEL_MAX_CHARS
    ? `${normalized.slice(0, WORKFLOW_LABEL_MAX_CHARS - 1)}…`
    : normalized
}

function clip(value: string, max: number): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function toDisplayString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? '[value]'
  } catch {
    return '[value]'
  }
}
