import { createHash } from 'crypto'
import vm from 'vm'
import { Ajv, type ValidateFunction } from 'ajv'
const createAbortController = () => new AbortController()
const logForDebugging = (message: string) => console.warn(message)
import { compileWorkflowCode, installDeterminismGuards } from './compile.js'
import {
  WORKFLOW_DEFAULT_RUN_TIMEOUT_MS,
  WORKFLOW_LOG_MAX_CHARS,
  WORKFLOW_MAX_AGENTS,
  WORKFLOW_MAX_COLLECTED_LOGS,
  WORKFLOW_MAX_FANOUT,
  WORKFLOW_SYNC_TIMEOUT_MS,
  getWorkflowConcurrency,
} from './constants.js'
import {
  parseWorkflowDefinition,
  walkWorkflowNodes,
  type WorkflowAgentNode,
  type WorkflowCodeNode,
  type WorkflowDefinitionV3,
  type WorkflowForeachNode,
  type WorkflowGraphEdge,
  type WorkflowInputBinding,
  type WorkflowNode,
  type WorkflowPredicate,
  type WorkflowSubgraph,
  type WorkflowValueSource,
} from './definition.js'
import { describeThrown } from './errors.js'
import {
  createWorkflowHarness,
  createWorkflowSharedCounters,
  type WorkflowHarness,
  type WorkflowHarnessParams,
  type WorkflowSharedCounters,
} from './harness.js'
import type { WorkflowJournal, WorkflowJournalSnapshot } from './journal.js'
import type {
  WorkflowNodeEvent,
  WorkflowProgressEvent,
  WorkflowRunOutcome,
  WorkflowTokenBudget,
} from './types.js'

export type PreparedWorkflowDefinition = {
  ok: true
  definition: WorkflowDefinitionV3
  scripts: Map<string, vm.Script>
  inputValidators: Map<string, ValidateFunction>
  outputValidators: Map<string, ValidateFunction>
}

export type PrepareWorkflowDefinitionResult =
  | PreparedWorkflowDefinition
  | { ok: false; error: string }

export type WorkflowExecutionParams = {
  prepared: PreparedWorkflowDefinition
  signal?: AbortSignal
  runId: string
  args?: unknown
  tokenBudget?: WorkflowTokenBudget
  journal?: WorkflowJournal
  journalSnapshot?: WorkflowJournalSnapshot
  onProgress?: (event: WorkflowProgressEvent) => void
  onAgentController: (agentKey: string, controller: AbortController | undefined) => void
  runNestedWorkflow?: (
    reference: { workflowId?: string; name?: string; revision?: number },
    args: unknown,
    parentInstanceId: string,
  ) => Promise<unknown>
  instancePrefix?: string
  syncTimeoutMs?: number
  runAgentImpl?: WorkflowHarnessParams['runAgentImpl']
  shared?: WorkflowSharedCounters
}

type ExecutionScope = {
  outputs: Map<string, unknown>
  parent?: ExecutionScope
  instancePrefix?: string
  agentScopePrefix?: string
  parentInstanceId?: string
  item?: unknown
  index?: number
  nodeVisits: Map<string, number>
  edgeTraversals: Map<string, number>
}

type NodeEventExtras = Pick<WorkflowNodeEvent, 'branch' | 'iteration' | 'itemIndex' | 'attempt' | 'cached' | 'error' | 'input' | 'output'>
type NodeResult = { output: unknown; ports: Set<string> }
type GraphResult = { output: unknown; terminal?: '$complete'; scope: ExecutionScope }
type ParallelFrame = {
  parallelId: string
  executionId: string
  branchPort: string
  expectedPorts: string[]
}
type Activation = {
  nodeId: string
  fromNodeId?: string
  parallelStack: ParallelFrame[]
  joinReady?: boolean
}

type Runtime = {
  definition: WorkflowDefinitionV3
  prepared: PreparedWorkflowDefinition
  args: unknown
  harness: WorkflowHarness
  abortController: AbortController
  parentAborted: boolean
  fatalError?: unknown
  deadlineAt: number
  tokenBudget?: WorkflowTokenBudget
  runNestedWorkflow?: WorkflowExecutionParams['runNestedWorkflow']
  syncTimeoutMs: number
  emit: (event: WorkflowProgressEvent) => void
  emitNode: (
    nodeId: string,
    instanceId: string,
    state: WorkflowNodeEvent['state'],
    parentInstanceId?: string,
    extras?: NodeEventExtras,
  ) => void
  emitEdge: (edgeId: string, source: string, target: string, state: 'selected' | 'skipped' | 'traversed', instanceId: string) => void
  agentRunning: Set<string>
  agentCached: Set<string>
  nodeExecutions: number
  agentCalls: number
  abortForFailure: (error: unknown) => void
}

export class WorkflowBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowBlockedError'
  }
}

export function prepareWorkflowDefinition(value: unknown): PrepareWorkflowDefinitionResult {
  const parsed = parseWorkflowDefinition(value)
  if (!parsed.ok) return parsed

  const scripts = new Map<string, vm.Script>()
  const inputValidators = new Map<string, ValidateFunction>()
  const outputValidators = new Map<string, ValidateFunction>()
  const ajv = new Ajv({ allErrors: true, addUsedSchema: false, strict: false })
  let error: string | undefined
  const compileSchema = (schema: unknown, path: string): ValidateFunction | undefined => {
    if (typeof schema !== 'boolean' && !isRecord(schema)) {
      error = `${path} must be a JSON Schema object or boolean`
      return undefined
    }
    try {
      if (!ajv.validateSchema(schema)) {
        error = `${path} is invalid: ${ajv.errorsText(ajv.errors)}`
        return undefined
      }
      return ajv.compile(schema)
    } catch (cause) {
      error = `${path}: ${describeThrown(cause)}`
      return undefined
    }
  }

  walkWorkflowNodes(parsed.definition.graph, node => {
    if (error) return
    if (node.type === 'code') {
      const compiled = compileWorkflowCode(node.script, `workflow:${parsed.definition.meta.name}:${node.id}:script.js`)
      if (!compiled.ok) {
        error = `definition node "${node.id}" script: ${compiled.error}`
        return
      }
      scripts.set(node.id, compiled.vmScript)
    }
    if ('inputSchema' in node && node.inputSchema !== undefined) {
      const validator = compileSchema(node.inputSchema, `definition node "${node.id}" inputSchema`)
      if (validator) inputValidators.set(node.id, validator)
    }
    if ('outputSchema' in node) {
      const validator = compileSchema(node.outputSchema, `definition node "${node.id}" outputSchema`)
      if (validator) outputValidators.set(node.id, validator)
    }
  })

  return error
    ? { ok: false, error }
    : { ok: true, definition: parsed.definition, scripts, inputValidators, outputValidators }
}

export async function executeWorkflowDefinition(params: WorkflowExecutionParams): Promise<WorkflowRunOutcome> {
  const startedAt = Date.now()
  const logs: string[] = []
  let sequence = 0
  const parentSignal = params.signal
  const abortController = createAbortController()
  let parentAborted = false
  const onParentAbort = (): void => {
    parentAborted = true
    abortController.abort(parentSignal?.reason ?? new Error('Workflow cancelled by user'))
  }
  if (parentSignal?.aborted) onParentAbort()
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true })

  const runTimeoutMs = params.prepared.definition.limits?.maxDurationMs ?? WORKFLOW_DEFAULT_RUN_TIMEOUT_MS
  const timeout = setTimeout(() => {
    const error = new Error(`Workflow run timed out after ${runTimeoutMs}ms`)
    runtime.fatalError = error
    abortController.abort(error)
  }, runTimeoutMs)
  timeout.unref?.()

  const rawEmit = (event: WorkflowProgressEvent): void => {
    const normalized = event.type === 'workflow_log' && event.message.length > WORKFLOW_LOG_MAX_CHARS
      ? { ...event, message: `${event.message.slice(0, WORKFLOW_LOG_MAX_CHARS)}…` }
      : event
    if (normalized.type === 'workflow_log' && logs.length < WORKFLOW_MAX_COLLECTED_LOGS) logs.push(normalized.message)
    params.onProgress?.(normalized)
  }
  const emitNode: Runtime['emitNode'] = (nodeId, instanceId, state, parentInstanceId, extras = {}) => {
    const event: WorkflowNodeEvent = {
      type: 'workflow_node', sequence: ++sequence, nodeId, instanceId,
      ...(parentInstanceId ? { parentInstanceId } : {}),
      state, timestamp: Date.now(), ...extras,
    }
    rawEmit(event)
    const { input: _input, output: _output, ...stateEvent } = event
    void params.journal?.append({ type: 'node', event: stateEvent }).catch(error =>
      logForDebugging(`workflow journal node-append failed: ${error}`),
    )
  }
  const emitEdge: Runtime['emitEdge'] = (edgeId, source, target, state, instanceId) => {
    rawEmit({ type: 'workflow_edge', sequence: ++sequence, edgeId, source, target, state, instanceId, timestamp: Date.now() })
  }
  const agentRunning = new Set<string>()
  const agentCached = new Set<string>()
  const emit = (event: WorkflowProgressEvent): void => {
    if (event.type === 'workflow_agent') {
      if (event.state === 'progress' && !agentRunning.has(event.instanceId)) {
        agentRunning.add(event.instanceId)
        emitNode(event.nodeId, event.instanceId, 'running', event.parentInstanceId)
      }
      if (event.state === 'done' && event.cached) agentCached.add(event.instanceId)
    }
    rawEmit(event)
  }
  const shared = params.shared ?? createWorkflowSharedCounters(
    workflowConcurrency(params.prepared.definition),
    params.prepared.definition.limits?.maxAgentCalls,
  )
  const harness = createWorkflowHarness({
    runId: params.runId,
    workflowName: params.prepared.definition.meta.name,
    emit,
    tokenBudget: params.tokenBudget,
    journal: params.journal,
    journalSnapshot: params.journalSnapshot,
    onAgentController: params.onAgentController,
    abortSignal: abortController.signal,
    runAgentImpl: params.runAgentImpl,
    shared,
  })
  const runtime: Runtime = {
    definition: params.prepared.definition,
    prepared: params.prepared,
    args: cloneJsonValue(params.args ?? {}),
    harness,
    abortController,
    parentAborted,
    deadlineAt: startedAt + runTimeoutMs,
    tokenBudget: params.tokenBudget,
    runNestedWorkflow: params.runNestedWorkflow,
    syncTimeoutMs: params.syncTimeoutMs ?? WORKFLOW_SYNC_TIMEOUT_MS,
    emit,
    emitNode,
    emitEdge,
    agentRunning,
    agentCached,
    nodeExecutions: 0,
    agentCalls: 0,
    abortForFailure(error) {
      if (this.fatalError === undefined) this.fatalError = error
      if (!this.abortController.signal.aborted) this.abortController.abort(error)
    },
  }
  // Parent cancellation may have happened before runtime was constructed.
  runtime.parentAborted = parentAborted

  try {
    const scope: ExecutionScope = {
      outputs: new Map(),
      nodeVisits: new Map(),
      edgeTraversals: new Map(),
      ...(params.instancePrefix ? { instancePrefix: params.instancePrefix, agentScopePrefix: params.instancePrefix } : {}),
    }
    const result = await executeGraph(runtime, runtime.definition.graph, scope, 'root')
    await params.journal?.flush()
    return {
      status: 'completed',
      result: cloneJsonValue(result.output),
      agentCount: harness.getAgentCount(),
      logs,
      failures: harness.getFailures(),
      durationMs: Date.now() - startedAt,
    }
  } catch (caught) {
    const error = runtime.fatalError ?? caught
    const message = describeThrown(error)
    logForDebugging(`Workflow ${params.runId} stopped: ${message}`)
    await params.journal?.flush().catch(() => {})
    const status = error instanceof WorkflowBlockedError
      ? 'blocked'
      : runtime.parentAborted || (parentSignal?.aborted && runtime.fatalError === undefined)
        ? 'cancelled'
        : 'failed'
    return {
      status,
      result: null,
      agentCount: harness.getAgentCount(),
      logs,
      failures: harness.getFailures(),
      durationMs: Date.now() - startedAt,
      error: message,
    }
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', onParentAbort)
    if (!abortController.signal.aborted) abortController.abort()
  }
}

async function executeGraph(
  runtime: Runtime,
  graph: WorkflowSubgraph,
  scope: ExecutionScope,
  kind: 'root' | 'foreach',
): Promise<GraphResult> {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const outgoing = new Map<string, WorkflowGraphEdge[]>(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) outgoing.get(edge.source)!.push(edge)

  let queue: Activation[] = [{ nodeId: graph.entry, parallelStack: [] }]
  const terminals: Array<{ target: string; scope: ExecutionScope }> = []
  const joinWaits = new Map<string, Map<string, Activation>>()

  while (queue.length > 0) {
    assertNotAborted(runtime)
    const current = queue
    queue = []
    const runnable: Activation[] = []

    for (const activation of current) {
      const node = nodes.get(activation.nodeId)
      if (!node) throw new Error(`Workflow scheduler reached unknown node "${activation.nodeId}"`)
      if (node.type !== 'join' || activation.joinReady) {
        runnable.push(activation)
        continue
      }
      const frame = activation.parallelStack.at(-1)
      if (!frame || frame.parallelId !== node.parallelId) {
        throw new Error(`${node.title}: reached without its parallel context`)
      }
      const key = `${node.id}\0${frame.executionId}`
      const arrivals = joinWaits.get(key) ?? new Map<string, Activation>()
      if (arrivals.has(frame.branchPort)) throw new Error(`${node.title}: branch "${frame.branchPort}" arrived more than once`)
      arrivals.set(frame.branchPort, activation)
      joinWaits.set(key, arrivals)
      if (frame.expectedPorts.every(port => arrivals.has(port))) {
        joinWaits.delete(key)
        runnable.push({
          nodeId: node.id,
          fromNodeId: activation.fromNodeId,
          parallelStack: activation.parallelStack.slice(0, -1),
          joinReady: true,
        })
      }
    }

    const produced = await mapWithConcurrency(runnable, workflowConcurrency(runtime.definition), async activation => {
      try {
        const node = nodes.get(activation.nodeId)!
        const { result, instanceId } = await executeNode(runtime, node, scope, activation.fromNodeId)
        const next: Activation[] = []
        const nodeEdges = outgoing.get(node.id) ?? []
        for (const edge of nodeEdges) {
          const selected = result.ports.has(edge.sourcePort ?? 'default')
          runtime.emitEdge(edgeKey(edge), edge.source, edge.target, selected ? 'selected' : 'skipped', instanceId)
          if (!selected) continue
          if (edge.kind === 'back') consumeBackEdge(scope, edge)
          runtime.emitEdge(edgeKey(edge), edge.source, edge.target, 'traversed', instanceId)
          let parallelStack = activation.parallelStack
          if (node.type === 'parallel') {
            parallelStack = [...parallelStack, {
              parallelId: node.id,
              executionId: instanceId,
              branchPort: edge.sourcePort!,
              expectedPorts: node.branches.map(branch => branch.port),
            }]
          }
          if (edge.target.startsWith('$')) terminals.push({ target: edge.target, scope })
          else next.push({ nodeId: edge.target, fromNodeId: node.id, parallelStack })
        }
        return next
      } catch (error) {
        if (!runtime.abortController.signal.aborted) runtime.abortForFailure(error)
        throw error
      }
    })
    queue.push(...produced.flat())
  }

  if (joinWaits.size > 0) {
    throw new Error(`Workflow scheduler stopped with incomplete parallel joins: ${[...joinWaits.keys()].map(key => key.split('\0')[0]).join(', ')}`)
  }
  if (kind === 'root') {
    const end = graph.nodes.find(node => node.type === 'end')
    if (!end || !scope.outputs.has(end.id)) throw new Error('Workflow did not reach the end node')
    return { output: scope.outputs.get(end.id), scope }
  }
  if (terminals.length !== 1 || terminals[0]!.target !== '$complete') {
    throw new Error(`Foreach body must reach exactly one $complete terminal; reached ${terminals.map(item => item.target).join(', ') || 'none'}`)
  }
  return { output: null, terminal: '$complete', scope: terminals[0]!.scope }
}

async function executeNode(
  runtime: Runtime,
  node: WorkflowNode,
  scope: ExecutionScope,
  fromNodeId?: string,
): Promise<{ result: NodeResult; instanceId: string }> {
  assertNotAborted(runtime)
  const visit = (scope.nodeVisits.get(node.id) ?? 0) + 1
  scope.nodeVisits.set(node.id, visit)
  const instanceId = nodeInstanceId(scope, node.id, visit)
  runtime.emitNode(node.id, instanceId, 'ready', scope.parentInstanceId, visit > 1 ? { iteration: visit } : {})
  if (node.disabled) {
    scope.outputs.set(node.id, null)
    runtime.emitNode(node.id, instanceId, 'skipped', scope.parentInstanceId)
    return { result: { output: null, ports: new Set(['default']) }, instanceId }
  }

  runtime.nodeExecutions++
  const maxExecutions = runtime.definition.limits?.maxNodeExecutions ?? 1_000
  if (runtime.nodeExecutions > maxExecutions) throw new Error(`Workflow node execution limit reached (${maxExecutions})`)
  try {
    const displayedInput = 'input' in node && node.input ? resolveBindings(node.input, scope, runtime.args) : node.type === 'start' ? runtime.args : undefined
    const result = await dispatchNode(runtime, node, scope, instanceId, fromNodeId)
    validateOutput(runtime, node, result.output)
    scope.outputs.set(node.id, result.output)
    runtime.emitNode(node.id, instanceId, 'completed', scope.parentInstanceId, {
      output: result.output,
      ...(displayedInput !== undefined ? { input: displayedInput } : {}),
      ...(result.ports.size === 1 ? { branch: [...result.ports][0] } : {}),
      ...(visit > 1 ? { iteration: visit } : {}),
      ...(scope.index !== undefined ? { itemIndex: scope.index } : {}),
      ...(runtime.agentCached.has(instanceId) ? { cached: true } : {}),
    })
    return { result, instanceId }
  } catch (error) {
    const message = describeThrown(error)
    const state = error instanceof WorkflowBlockedError
      ? 'blocked'
      : runtime.abortController.signal.aborted && runtime.fatalError === undefined
        ? 'cancelled'
        : 'failed'
    runtime.emitNode(node.id, instanceId, state, scope.parentInstanceId, { error: message })
    throw error
  }
}

async function dispatchNode(
  runtime: Runtime,
  node: WorkflowNode,
  scope: ExecutionScope,
  instanceId: string,
  fromNodeId?: string,
): Promise<NodeResult> {
  switch (node.type) {
    case 'start':
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      return { output: runtime.args, ports: new Set(['default']) }
    case 'end': {
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      const output = resolveBindings(node.input, scope, runtime.args)
      validateInput(runtime, node, output)
      return { output, ports: new Set() }
    }
    case 'agent': return executeAgentNode(runtime, node, scope, instanceId)
    case 'code': return executeCodeNode(runtime, node, scope, instanceId)
    case 'condition': {
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      const selected = node.branches.find(branch => evaluatePredicate(branch.when, scope, runtime.args))
      const port = selected?.port ?? node.default.port
      return { output: { selectedPort: port }, ports: new Set([port]) }
    }
    case 'parallel':
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      return { output: {}, ports: new Set(node.branches.map(branch => branch.port)) }
    case 'join':
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      return { output: {}, ports: new Set(['default']) }
    case 'workflow': {
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      if (!runtime.runNestedWorkflow) throw new Error('Nested workflows are not available in this run')
      const input = resolveBindings(node.input ?? [], scope, runtime.args)
      validateInput(runtime, node, input)
      const output = await runtime.runNestedWorkflow(
        { ...(node.workflowId ? { workflowId: node.workflowId } : {}), ...(node.name ? { name: node.name } : {}), ...(node.revision ? { revision: node.revision } : {}) },
        input,
        instanceId,
      )
      return { output, ports: new Set(['default']) }
    }
    case 'merge': {
      runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
      const orderedSources = fromNodeId
        ? [
            ...node.sources.filter(source => source.kind === 'node-output' && source.nodeId === fromNodeId),
            ...node.sources.filter(source => source.kind !== 'node-output' || source.nodeId !== fromNodeId),
          ]
        : node.sources
      for (const source of orderedSources) {
        try {
          const output = resolveSource(source, scope, runtime.args)
          if (output !== undefined && output !== null) return { output, ports: new Set(['default']) }
        } catch {}
      }
      throw new Error(`${node.title}: no branch output is available`)
    }
    case 'foreach': return executeForeachNode(runtime, node, scope, instanceId)
  }
}

async function executeAgentNode(runtime: Runtime, node: WorkflowAgentNode, scope: ExecutionScope, instanceId: string): Promise<NodeResult> {
  runtime.agentCalls++
  const maxAgents = Math.min(runtime.definition.limits?.maxAgentCalls ?? WORKFLOW_MAX_AGENTS, WORKFLOW_MAX_AGENTS)
  if (runtime.agentCalls > maxAgents) throw new Error(`Workflow Agent call limit reached (${maxAgents})`)
  runtime.emitNode(node.id, instanceId, 'queued', scope.parentInstanceId)
  const input = resolveBindings(node.input ?? [], scope, runtime.args)
  validateInput(runtime, node, input)
  // Keep runtime data flow identical to the graph: an Agent sees only the
  // values selected by its input bindings. Passing all run arguments here
  // would create hidden dependencies that the Definition cannot visualize.
  const prompt = `${node.prompt}\n\n<node-input>\n${safeStringify(input)}\n</node-input>`
  const resultSchema = agentResultSchema(node.outputSchema)
  const opts = {
    label: node.title,
    schema: resultSchema,
    ...(node.agentType ? { agentType: node.agentType } : {}),
  }
  const cacheKey = stableNodeCacheKey(instanceId, input, { prompt: node.prompt, outputSchema: node.outputSchema, ...opts })
  const raw = await runtime.harness.agent(prompt, opts, {
    nodeId: node.id,
    instanceId,
    sessionKey: agentSessionKey(scope, node.id),
    cacheKey,
    ...(scope.parentInstanceId ? { parentInstanceId: scope.parentInstanceId } : {}),
    ...(node.execution?.timeoutMs ? { timeoutMs: Math.min(node.execution.timeoutMs, remainingMs(runtime)) } : { timeoutMs: remainingMs(runtime) }),
  })
  if (!isRecord(raw) || (raw.status !== 'completed' && raw.status !== 'blocked')) {
    throw new Error(`${node.title}: Agent returned an invalid execution status`)
  }
  if (raw.status === 'blocked') {
    throw new WorkflowBlockedError(`${node.title}: ${typeof raw.reason === 'string' ? raw.reason : 'required input or prerequisite is missing'}`)
  }
  return { output: raw.output, ports: new Set(['default']) }
}

function executeCodeNode(runtime: Runtime, node: WorkflowCodeNode, scope: ExecutionScope, instanceId: string): NodeResult {
  runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
  const input = resolveBindings(node.input ?? [], scope, runtime.args)
  validateInput(runtime, node, input)
  return { output: executeNodeJavaScript(runtime, node.id, input, scope, instanceId), ports: new Set(['default']) }
}

async function executeForeachNode(runtime: Runtime, node: WorkflowForeachNode, scope: ExecutionScope, instanceId: string): Promise<NodeResult> {
  runtime.emitNode(node.id, instanceId, 'running', scope.parentInstanceId)
  const items = resolveSource(node.items, scope, runtime.args)
  if (!Array.isArray(items)) throw new Error(`${node.title}: items must resolve to an array`)
  if (items.length > WORKFLOW_MAX_FANOUT) throw new Error(`${node.title}: items exceed the ${WORKFLOW_MAX_FANOUT} item limit`)
  runtime.emitNode(node.id, instanceId, 'waiting_children', scope.parentInstanceId)
  const results = await mapWithConcurrency(
    items,
    Math.min(node.concurrency ?? Number.POSITIVE_INFINITY, workflowConcurrency(runtime.definition)),
    async (item, index) => {
      const stablePrefix = `${scope.agentScopePrefix ? `${scope.agentScopePrefix}/` : ''}${node.id}[${index}]`
      const itemScope: ExecutionScope = {
        outputs: new Map(),
        parent: scope,
        instancePrefix: `${instanceId}[${index}]`,
        agentScopePrefix: stablePrefix,
        parentInstanceId: instanceId,
        item,
        index,
        nodeVisits: new Map(),
        edgeTraversals: new Map(),
      }
      const result = await executeGraph(runtime, node.body, itemScope, 'foreach')
      if (result.terminal !== '$complete') throw new Error(`${node.title}[${index}]: body did not complete`)
      return resolveBindings(node.output ?? [], result.scope, runtime.args)
    },
  )
  return { output: results, ports: new Set(['default']) }
}

function consumeBackEdge(scope: ExecutionScope, edge: WorkflowGraphEdge): void {
  const key = edgeKey(edge)
  const traversals = (scope.edgeTraversals.get(key) ?? 0) + 1
  const limit = edge.maxTraversals!
  if (traversals > limit) throw new Error(`Workflow back edge ${edge.source} → ${edge.target} reached its limit (${limit})`)
  scope.edgeTraversals.set(key, traversals)
}

function agentResultSchema(outputSchema: unknown): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: 'object',
        required: ['status', 'output'],
        additionalProperties: false,
        properties: {
          status: { const: 'completed' },
          output: outputSchema,
        },
      },
      {
        type: 'object',
        required: ['status', 'reason'],
        additionalProperties: false,
        properties: {
          status: { const: 'blocked' },
          reason: { type: 'string', minLength: 1 },
        },
      },
    ],
  }
}

function validateInput(runtime: Runtime, node: WorkflowNode, input: unknown): void {
  const validate = runtime.prepared.inputValidators.get(node.id)
  if (validate && !validate(input)) throw new Error(`${node.title}: input does not match inputSchema: ${formatValidationErrors(validate)}`)
}

function validateOutput(runtime: Runtime, node: WorkflowNode, output: unknown): void {
  const validate = runtime.prepared.outputValidators.get(node.id)
  if (validate && !validate(output)) throw new Error(`${node.title}: output does not match outputSchema: ${formatValidationErrors(validate)}`)
}

function resolveBindings(bindings: WorkflowInputBinding[], scope: ExecutionScope, args: unknown): unknown {
  let result: unknown = {}
  for (const binding of bindings) result = setPath(result, binding.target, resolveSource(binding.source, scope, args))
  return result
}

export function resolveWorkflowSource(source: WorkflowValueSource, scope: ExecutionScope, args: unknown): unknown {
  return resolveSource(source, scope, args)
}

function resolveSource(source: WorkflowValueSource, scope: ExecutionScope, args: unknown): unknown {
  switch (source.kind) {
    case 'literal': return cloneJsonValue(source.value)
    case 'workflow-input': return readPath(args, source.path ?? [], 'workflow-input')
    case 'iteration-item': return readPath(scope.item, source.path ?? [], 'iteration-item')
    case 'iteration-index': return scope.index
    case 'node-output': {
      let current: ExecutionScope | undefined = scope
      while (current && !current.outputs.has(source.nodeId)) current = current.parent
      if (!current?.outputs.has(source.nodeId)) throw new Error(`Workflow output "${source.nodeId}" is not available in this execution`)
      return readPath(current.outputs.get(source.nodeId), source.path ?? [], `node-output:${source.nodeId}`)
    }
  }
}

function evaluatePredicate(predicate: WorkflowPredicate, scope: ExecutionScope, args: unknown): boolean {
  if ('all' in predicate) return predicate.all.every(item => evaluatePredicate(item, scope, args))
  if ('any' in predicate) return predicate.any.some(item => evaluatePredicate(item, scope, args))
  if ('not' in predicate) return !evaluatePredicate(predicate.not, scope, args)
  const left = resolveSource(predicate.left, scope, args)
  const right = predicate.right ? resolveSource(predicate.right, scope, args) : undefined
  switch (predicate.operator) {
    case 'equals': return deepEqualJson(left, right)
    case 'not-equals': return !deepEqualJson(left, right)
    case 'greater-than': return comparable(left) > comparable(right)
    case 'greater-than-or-equal': return comparable(left) >= comparable(right)
    case 'less-than': return comparable(left) < comparable(right)
    case 'less-than-or-equal': return comparable(left) <= comparable(right)
    case 'contains': return contains(left, right)
    case 'not-contains': return !contains(left, right)
    case 'starts-with': return typeof left === 'string' && typeof right === 'string' && left.startsWith(right)
    case 'ends-with': return typeof left === 'string' && typeof right === 'string' && left.endsWith(right)
    case 'is-empty': return isEmpty(left)
    case 'is-not-empty': return !isEmpty(left)
    case 'exists': return left !== undefined && left !== null
    case 'not-exists': return left === undefined || left === null
  }
}

function comparable(value: unknown): number | string {
  if (typeof value === 'number' || typeof value === 'string') return value
  throw new Error('Ordered comparison requires number or string operands')
}

function contains(left: unknown, right: unknown): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left.includes(right)
  if (Array.isArray(left)) return left.some(item => deepEqualJson(item, right))
  return false
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

function executeNodeJavaScript(runtime: Runtime, nodeId: string, input: unknown, scope: ExecutionScope, instanceId: string): unknown {
  const script = runtime.prepared.scripts.get(nodeId)
  if (!script) throw new Error(`Compiled JavaScript is missing for node "${nodeId}"`)
  const context = vm.createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } })
  installDeterminismGuards(context)
  const define = (name: string, value: unknown) => Object.defineProperty(context, name, { value, writable: false, enumerable: true, configurable: false })
  define('__workflowContextJson', safeStringify({
    input: cloneJsonValue(input),
    item: cloneJsonValue(scope.item),
    index: scope.index,
  }))
  const timeout = codeNodeTimeout(runtime, nodeId)
  vm.runInContext(`(() => {
    const values = JSON.parse(globalThis.__workflowContextJson)
    const logs = []
    const format = value => {
      if (typeof value === 'string') return value
      try { return JSON.stringify(value) ?? 'null' } catch { return String(value) }
    }
    const write = value => logs.push(format(value))
    Object.defineProperties(globalThis, {
      input: { value: values.input, writable: false },
      item: { value: values.item, writable: false },
      index: { value: values.index, writable: false },
      log: { value: write, writable: false },
      console: { value: Object.freeze({ log: write, info: write, warn: write, error: write, debug: write }), writable: false },
      __workflowTakeLogs: { value: () => JSON.stringify(logs), writable: false },
    })
  })()`, context, { timeout, filename: `workflow:${nodeId}:context.js` })
  const flushLogs = (): void => {
    const serializedLogs = vm.runInContext('globalThis.__workflowTakeLogs()', context, { timeout, filename: `workflow:${nodeId}:logs.js` })
    if (typeof serializedLogs !== 'string') throw new Error('Node JavaScript produced invalid logs')
    for (const message of JSON.parse(serializedLogs) as string[]) runtime.emit({ type: 'workflow_log', nodeId, instanceId, message })
  }
  try {
    script.runInContext(context, { timeout })
  } catch (error) {
    flushLogs()
    throw error
  }
  const serialized = vm.runInContext(`(() => {
    const value = globalThis.__workflowResult
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
      if (typeof value.catch === 'function') value.catch(() => {})
      throw new Error('Node JavaScript must return synchronously; asynchronous work belongs in an Agent or Workflow node')
    }
    if (typeof value === 'function') throw new Error('Node JavaScript cannot return a function')
    return JSON.stringify(value === undefined ? null : value)
  })()`, context, { timeout, filename: `workflow:${nodeId}:result.js` }) as string
  if (typeof serialized !== 'string') throw new Error('Node JavaScript must return a JSON-serializable value')
  flushLogs()
  return JSON.parse(serialized) as unknown
}

function setPath(root: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return cloneJsonValue(value)
  const result = isRecord(root) ? root : {}
  let current = result as Record<string, unknown>
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index]!
    if (!isRecord(current[segment])) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
  current[path.at(-1)!] = cloneJsonValue(value)
  return result
}

function readPath(value: unknown, path: string[], ref: string): unknown {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Workflow reference "${ref}" could not resolve "${segment}"`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return cloneJsonValue(current)
}

function edgeKey(edge: WorkflowGraphEdge): string {
  return `${edge.source}:${edge.sourcePort ?? 'default'}->${edge.target}`
}

function nodeInstanceId(scope: ExecutionScope, nodeId: string, visit: number): string {
  const local = visit === 1 ? nodeId : `${nodeId}[${visit}]`
  return scope.instancePrefix ? `${scope.instancePrefix}/${local}` : local
}

function agentSessionKey(scope: ExecutionScope, nodeId: string): string {
  return scope.agentScopePrefix ? `${scope.agentScopePrefix}/${nodeId}` : nodeId
}

async function mapWithConcurrency<T, R>(values: T[], rawConcurrency: number, run: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const concurrency = Math.max(1, Math.min(values.length || 1, rawConcurrency))
  const results = new Array<R>(values.length)
  let next = 0
  let failure: unknown
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (failure === undefined) {
      const index = next++
      if (index >= values.length) return
      try {
        results[index] = await run(values[index]!, index)
      } catch (error) {
        failure = error
        return
      }
    }
  }))
  if (failure !== undefined) throw failure
  return results
}

function stableNodeCacheKey(instanceId: string, input: unknown, config: unknown): string {
  return `node:${createHash('sha256').update(instanceId).update('\0').update(stableStringify(input)).update('\0').update(stableStringify(config)).digest('hex')}`
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const normalize = (entry: unknown): unknown => {
    if (typeof entry === 'bigint') return entry.toString()
    if (entry === undefined || typeof entry === 'function') return null
    if (entry === null || typeof entry !== 'object') return entry
    if (seen.has(entry as object)) throw new Error('Workflow values cannot be circular')
    seen.add(entry as object)
    const result = Array.isArray(entry)
      ? entry.map(normalize)
      : Object.fromEntries(Object.keys(entry as Record<string, unknown>).sort().map(key => [key, normalize((entry as Record<string, unknown>)[key])]))
    seen.delete(entry as object)
    return result
  }
  return JSON.stringify(normalize(value)) ?? 'null'
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value) ?? 'null' }
  catch { throw new Error('Workflow values must be JSON-serializable') }
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(safeStringify(value)) as T
}

function formatValidationErrors(validate: ValidateFunction): string {
  return validate.errors?.map(error => `${error.instancePath || 'root'} ${error.message}`).join(', ') ?? 'validation failed'
}

function deepEqualJson(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function codeNodeTimeout(runtime: Runtime, nodeId: string): number {
  let timeout = Math.min(runtime.syncTimeoutMs, remainingMs(runtime))
  walkWorkflowNodes(runtime.definition.graph, node => {
    if (node.id === nodeId && node.type === 'code' && node.execution?.timeoutMs) timeout = Math.min(timeout, node.execution.timeoutMs)
  })
  return Math.max(1, timeout)
}

function remainingMs(runtime: Runtime): number {
  return Math.max(1, runtime.deadlineAt - Date.now())
}

function assertNotAborted(runtime: Runtime): void {
  if (Date.now() >= runtime.deadlineAt) throw new Error('Workflow run timed out')
  if (runtime.abortController.signal.aborted) throw runtime.abortController.signal.reason ?? new Error('Workflow cancelled')
}

function workflowConcurrency(definition: WorkflowDefinitionV3): number {
  return Math.max(1, Math.min(
    getWorkflowConcurrency(),
    definition.defaults?.concurrency ?? Number.POSITIVE_INFINITY,
    definition.limits?.maxConcurrency ?? Number.POSITIVE_INFINITY,
  ))
}
