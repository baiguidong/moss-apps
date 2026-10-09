import type { WorkflowDefinitionV3 } from './definition.js'

export type WorkflowSource =
  | 'built-in'
  | 'userSettings'
  | 'projectSettings'
  | 'plugin'
  | 'inline'

/** A discovered, validated structured workflow. */
export type WorkflowDefinition = {
  source: WorkflowSource
  name: string
  title: string
  description: string
  definition: WorkflowDefinitionV3
  filePath?: string
}

export type WorkflowAgentRunState = 'start' | 'progress' | 'done' | 'error'

export type WorkflowAgentEvent = {
  type: 'workflow_agent'
  index: number
  nodeId: string
  instanceId: string
  parentInstanceId?: string
  label: string
  state: WorkflowAgentRunState
  phaseIndex?: number
  phaseTitle?: string
  agentType?: string
  isolation?: 'worktree' | 'remote'
  agentId?: string
  queuedAt?: number
  startedAt?: number
  lastProgressAt?: number
  durationMs?: number
  tokens?: number
  toolCalls?: number
  cached?: boolean
  skipped?: boolean
  blocked?: boolean
  error?: string
  promptPreview?: string
  resultPreview?: string
  lastToolName?: string
}

export type WorkflowPhaseEvent = {
  type: 'workflow_phase'
  index: number
  nodeId?: string
  title: string
  kind: 'definition'
}

export type WorkflowLogEvent = {
  type: 'workflow_log'
  message: string
  nodeId?: string
  instanceId?: string
}

export type WorkflowNodeState =
  | 'ready'
  | 'queued'
  | 'running'
  | 'waiting_children'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'interrupted'

/** Authoritative lifecycle transition emitted by the structured executor. */
export type WorkflowNodeEvent = {
  type: 'workflow_node'
  output?: unknown
  input?: unknown
  sequence: number
  nodeId: string
  instanceId: string
  parentInstanceId?: string
  state: WorkflowNodeState
  timestamp: number
  branch?: string
  iteration?: number
  itemIndex?: number
  attempt?: number
  cached?: boolean
  error?: string
}

export type WorkflowEdgeEvent = {
  type: 'workflow_edge'
  sequence: number
  edgeId: string
  source: string
  target: string
  instanceId: string
  state: 'selected' | 'skipped' | 'traversed'
  timestamp: number
}

export type WorkflowProgressEvent =
  | WorkflowAgentEvent
  | WorkflowPhaseEvent
  | WorkflowLogEvent
  | WorkflowNodeEvent
  | WorkflowEdgeEvent

export function isWorkflowAgentEvent(
  event: WorkflowProgressEvent,
): event is WorkflowAgentEvent {
  return event.type === 'workflow_agent'
}

export function isWorkflowPhaseEvent(
  event: WorkflowProgressEvent,
): event is WorkflowPhaseEvent {
  return event.type === 'workflow_phase'
}

export function isDurableWorkflowEvent(event: WorkflowProgressEvent): boolean {
  return event.type !== 'workflow_log'
}

export type WorkflowAgentOptions = {
  label?: string
  phase?: string
  schema?: unknown
  agentType?: string
  stallMs?: number
}

export type WorkflowAgentInvocation = {
  nodeId: string
  instanceId: string
  /** Stable logical Agent identity reused when a graph cycle revisits a node. */
  sessionKey: string
  cacheKey: string
  phaseTitle?: string
  parentInstanceId?: string
  timeoutMs?: number
}

export type WorkflowRunOutcome = {
  status: 'completed' | 'blocked' | 'failed' | 'cancelled'
  result: unknown
  agentCount: number
  logs: string[]
  failures: string[]
  durationMs: number
  error?: string
}

export type WorkflowTokenBudget = {
  total: number | null
  getTurnSpent: () => number
}
