import { z } from 'zod/v4'
import {
  WORKFLOW_MAX_BACK_EDGE_TRAVERSALS,
  WORKFLOW_SCRIPT_MAX_BYTES,
} from './constants.js'

export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue }

export type WorkflowValueSource =
  | { kind: 'literal'; value: WorkflowJsonValue }
  | { kind: 'workflow-input'; path?: string[] }
  | { kind: 'node-output'; nodeId: string; path?: string[] }
  | { kind: 'iteration-item'; path?: string[] }
  | { kind: 'iteration-index' }

export type WorkflowInputBinding = {
  target: string[]
  source: WorkflowValueSource
}

export type WorkflowExecutionPolicy = {
  timeoutMs?: number
}

export type WorkflowNodeBase = {
  id: string
  type: string
  title: string
  description?: string
  disabled?: boolean
}

export type WorkflowStartNode = WorkflowNodeBase & {
  type: 'start'
  outputSchema: unknown
}

export type WorkflowEndNode = WorkflowNodeBase & {
  type: 'end'
  inputSchema: unknown
  input: WorkflowInputBinding[]
}

export type WorkflowAgentNode = WorkflowNodeBase & {
  type: 'agent'
  prompt: string
  inputSchema?: unknown
  input?: WorkflowInputBinding[]
  outputSchema: unknown
  agentType?: string
  execution?: WorkflowExecutionPolicy
}

export type WorkflowCodeNode = WorkflowNodeBase & {
  type: 'code'
  language: 'javascript'
  script: string
  inputSchema?: unknown
  input?: WorkflowInputBinding[]
  outputSchema: unknown
  execution?: WorkflowExecutionPolicy
}

export type WorkflowComparisonOperator =
  | 'equals'
  | 'not-equals'
  | 'greater-than'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'less-than-or-equal'
  | 'contains'
  | 'not-contains'
  | 'starts-with'
  | 'ends-with'
  | 'is-empty'
  | 'is-not-empty'
  | 'exists'
  | 'not-exists'

export type WorkflowPredicate =
  | { all: WorkflowPredicate[] }
  | { any: WorkflowPredicate[] }
  | { not: WorkflowPredicate }
  | {
      left: WorkflowValueSource
      operator: WorkflowComparisonOperator
      right?: WorkflowValueSource
    }

export type WorkflowConditionNode = WorkflowNodeBase & {
  type: 'condition'
  branches: Array<{ port: string; label: string; when: WorkflowPredicate }>
  default: { port: string; label: string }
}

export type WorkflowParallelNode = WorkflowNodeBase & {
  type: 'parallel'
  branches: Array<{ port: string; label: string }>
}

export type WorkflowJoinNode = WorkflowNodeBase & {
  type: 'join'
  parallelId: string
}

export type WorkflowChildNode = WorkflowNodeBase & {
  type: 'workflow'
  workflowId?: string
  name?: string
  revision?: number
  input?: WorkflowInputBinding[]
  inputSchema?: unknown
  outputSchema: unknown
  execution?: WorkflowExecutionPolicy
}

export type WorkflowMergeNode = WorkflowNodeBase & {
  type: 'merge'
  mode: 'first-available'
  sources: WorkflowValueSource[]
  outputSchema: unknown
}

export type WorkflowGraphEdge = {
  source: string
  target: string
  sourcePort?: string
  label?: string
  /** A bounded control-flow edge that revisits an earlier node. */
  kind?: 'back'
  /** Required for back edges; the run fails before traversal N + 1. */
  maxTraversals?: number
}

export type WorkflowSubgraph = {
  entry: string
  nodes: WorkflowNode[]
  edges: WorkflowGraphEdge[]
}

/** Foreach remains a scoped batch primitive; condition loops use graph back edges. */
export type WorkflowForeachNode = WorkflowNodeBase & {
  type: 'foreach'
  items: WorkflowValueSource
  concurrency?: number
  body: WorkflowSubgraph
  output?: WorkflowInputBinding[]
  outputSchema: unknown
}

export type WorkflowNode =
  | WorkflowStartNode
  | WorkflowEndNode
  | WorkflowAgentNode
  | WorkflowCodeNode
  | WorkflowConditionNode
  | WorkflowParallelNode
  | WorkflowJoinNode
  | WorkflowChildNode
  | WorkflowMergeNode
  | WorkflowForeachNode

export type WorkflowDefinitionV3 = {
  version: 3
  kind: 'state-machine'
  meta: {
    name: string
    title: string
    description: string
  }
  defaults?: {
    concurrency?: number
  }
  limits?: {
    maxAgentCalls?: number
    maxNodeExecutions?: number
    maxConcurrency?: number
    maxDurationMs?: number
  }
  graph: WorkflowSubgraph
}

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const PORT_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_DEFINITION_NODES = 240
const MAX_LABEL_LENGTH = 120
const MAX_NODE_EXECUTIONS = 10_000
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000

const idSchema = z.string().regex(ID_PATTERN)
const portSchema = z.string().regex(PORT_PATTERN)
const titleSchema = z.string().min(1).max(MAX_LABEL_LENGTH).refine(isHumanReadableTitle, {
  message: 'must be a short human-readable action or question, not source code',
})
const jsonSchemaSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())])
const jsonValueSchema: z.ZodType<WorkflowJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))
const pathSegmentSchema = z.string().min(1).refine(
  value => !['__proto__', 'prototype', 'constructor'].includes(value),
  { message: 'uses a reserved property name' },
)
const pathSchema = z.array(pathSegmentSchema).max(64).optional()

export const workflowValueSourceSchema: z.ZodType<WorkflowValueSource> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), value: jsonValueSchema }),
  z.strictObject({ kind: z.literal('workflow-input'), path: pathSchema }),
  z.strictObject({ kind: z.literal('node-output'), nodeId: idSchema, path: pathSchema }),
  z.strictObject({ kind: z.literal('iteration-item'), path: pathSchema }),
  z.strictObject({ kind: z.literal('iteration-index') }),
]) as z.ZodType<WorkflowValueSource>

const bindingSchema: z.ZodType<WorkflowInputBinding> = z.strictObject({
  target: z.array(pathSegmentSchema).max(64),
  source: workflowValueSourceSchema,
})
const executionPolicySchema = z.strictObject({
  timeoutMs: z.number().int().positive().max(MAX_DURATION_MS).optional().describe(
    'Hard cancellation deadline for this node. Omit unless the user explicitly requires a per-node deadline.',
  ),
}).describe('Optional node execution safety policy; it does not estimate normal latency.')
const baseShape = {
  id: idSchema,
  title: titleSchema,
  description: z.string().max(1_000).optional(),
  disabled: z.boolean().optional(),
}

const operatorSchema = z.enum([
  'equals', 'not-equals', 'greater-than', 'greater-than-or-equal',
  'less-than', 'less-than-or-equal', 'contains', 'not-contains',
  'starts-with', 'ends-with', 'is-empty', 'is-not-empty', 'exists', 'not-exists',
])
let predicateSchemaImpl: z.ZodType<WorkflowPredicate>
export const workflowPredicateSchema: z.ZodType<WorkflowPredicate> = z.lazy(() => predicateSchemaImpl)
predicateSchemaImpl = z.union([
  z.strictObject({ all: z.array(workflowPredicateSchema).min(1).max(32) }),
  z.strictObject({ any: z.array(workflowPredicateSchema).min(1).max(32) }),
  z.strictObject({ not: workflowPredicateSchema }),
  z.strictObject({
    left: workflowValueSourceSchema,
    operator: operatorSchema,
    right: workflowValueSourceSchema.optional(),
  }),
]) as z.ZodType<WorkflowPredicate>

const edgeSchema: z.ZodType<WorkflowGraphEdge> = z.strictObject({
  source: idSchema,
  target: z.string().min(1).max(64),
  sourcePort: portSchema.optional(),
  label: titleSchema.optional(),
  kind: z.literal('back').optional(),
  maxTraversals: z.number().int().min(1).max(WORKFLOW_MAX_BACK_EDGE_TRAVERSALS).optional(),
}).superRefine((edge, context) => {
  if (edge.kind === 'back' && edge.maxTraversals === undefined) {
    context.addIssue({ code: 'custom', path: ['maxTraversals'], message: 'is required for a back edge' })
  }
  if (edge.kind !== 'back' && edge.maxTraversals !== undefined) {
    context.addIssue({ code: 'custom', path: ['maxTraversals'], message: 'is only valid for a back edge' })
  }
})

const startNodeSchema = z.strictObject({ ...baseShape, type: z.literal('start'), outputSchema: jsonSchemaSchema })
const endNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('end'),
  inputSchema: jsonSchemaSchema,
  input: z.array(bindingSchema).max(128),
})
const agentNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('agent'),
  prompt: z.string().min(1).max(WORKFLOW_SCRIPT_MAX_BYTES),
  inputSchema: jsonSchemaSchema.optional(),
  input: z.array(bindingSchema).max(128).optional(),
  outputSchema: jsonSchemaSchema,
  agentType: z.string().min(1).optional(),
  execution: executionPolicySchema.optional(),
})
const codeNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('code'),
  language: z.literal('javascript'),
  script: z.string().min(1).max(WORKFLOW_SCRIPT_MAX_BYTES),
  inputSchema: jsonSchemaSchema.optional(),
  input: z.array(bindingSchema).max(128).optional(),
  outputSchema: jsonSchemaSchema,
  execution: executionPolicySchema.optional(),
})
const conditionNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('condition'),
  branches: z.array(z.strictObject({ port: portSchema, label: titleSchema, when: workflowPredicateSchema })).min(1).max(32),
  default: z.strictObject({ port: portSchema, label: titleSchema }),
})
const parallelNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('parallel'),
  branches: z.array(z.strictObject({ port: portSchema, label: titleSchema })).min(2).max(32),
})
const joinNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('join'),
  parallelId: idSchema,
})
const childWorkflowNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('workflow'),
  workflowId: z.string().min(1).optional(),
  name: z.string().min(1).max(128).optional(),
  revision: z.number().int().positive().optional(),
  input: z.array(bindingSchema).max(128).optional(),
  inputSchema: jsonSchemaSchema.optional(),
  outputSchema: jsonSchemaSchema,
  execution: executionPolicySchema.optional(),
}).superRefine((node, context) => {
  if ((node.workflowId === undefined) === (node.name === undefined)) {
    context.addIssue({ code: 'custom', message: 'workflow requires exactly one of workflowId or name' })
  }
  if (node.revision !== undefined && node.workflowId === undefined) {
    context.addIssue({ code: 'custom', path: ['revision'], message: 'revision requires workflowId' })
  }
})
const mergeNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('merge'),
  mode: z.literal('first-available'),
  sources: z.array(workflowValueSourceSchema).min(1).max(64),
  outputSchema: jsonSchemaSchema,
})

const bodyNodeAuthoringSchema = z.discriminatedUnion('type', [
  agentNodeSchema,
  codeNodeSchema,
  conditionNodeSchema,
  parallelNodeSchema,
  joinNodeSchema,
  childWorkflowNodeSchema,
  mergeNodeSchema,
])
const bodyGraphSchema = z.strictObject({
  entry: idSchema,
  nodes: z.array(bodyNodeAuthoringSchema).min(1).max(MAX_DEFINITION_NODES),
  edges: z.array(edgeSchema).max(2_048),
})
const foreachOutputSchema = z.record(z.string(), z.unknown()).superRefine((schema, context) => {
  const declaredType = schema.type
  if (declaredType !== 'array' && !(Array.isArray(declaredType) && declaredType.includes('array'))) {
    context.addIssue({
      code: 'custom',
      message: 'foreach outputSchema must declare type="array" because foreach always returns an array',
    })
  }
})
const foreachNodeSchema = z.strictObject({
  ...baseShape,
  type: z.literal('foreach'),
  items: workflowValueSourceSchema,
  concurrency: z.number().int().min(1).max(64).optional(),
  body: bodyGraphSchema,
  output: z.array(bindingSchema).max(128).optional(),
  outputSchema: foreachOutputSchema.describe(
    'Schema for the complete foreach result array. output bindings build one item in that array.',
  ),
})
const rootNodeSchema = z.discriminatedUnion('type', [
  startNodeSchema,
  endNodeSchema,
  agentNodeSchema,
  codeNodeSchema,
  conditionNodeSchema,
  parallelNodeSchema,
  joinNodeSchema,
  childWorkflowNodeSchema,
  mergeNodeSchema,
  foreachNodeSchema,
])
const rootGraphSchema = z.strictObject({
  entry: idSchema,
  nodes: z.array(rootNodeSchema).min(1).max(MAX_DEFINITION_NODES),
  edges: z.array(edgeSchema).max(2_048),
})

export const workflowNodeSchema: z.ZodType<WorkflowNode> = rootNodeSchema as z.ZodType<WorkflowNode>
export const workflowDefinitionSchema: z.ZodType<WorkflowDefinitionV3> = z.strictObject({
  version: z.literal(3),
  kind: z.literal('state-machine'),
  meta: z.strictObject({
    name: z.string().regex(WORKFLOW_NAME_PATTERN),
    title: titleSchema,
    description: z.string().min(1).max(1_000),
  }),
  defaults: z.strictObject({
    concurrency: z.number().int().min(1).max(64).optional(),
  }).optional(),
  limits: z.strictObject({
    maxAgentCalls: z.number().int().min(1).max(1_000).optional(),
    maxNodeExecutions: z.number().int().min(1).max(MAX_NODE_EXECUTIONS).optional(),
    maxConcurrency: z.number().int().min(1).max(64).optional(),
    maxDurationMs: z.number().int().min(1_000).max(MAX_DURATION_MS).optional().describe(
      'Hard deadline for the complete run, not a source for per-node timeout estimates.',
    ),
  }).optional(),
  graph: rootGraphSchema,
}) as z.ZodType<WorkflowDefinitionV3>

/** The model sees this non-recursive schema; runtime validation runs again before save/run. */
export const workflowDefinitionAuthoringSchema = workflowDefinitionSchema.describe(
  'Complete Workflow Definition v3. A condition loop is a bounded edge with kind="back"; never create a loop wrapper node.',
)

export type WorkflowDefinitionResult =
  | { ok: true; definition: WorkflowDefinitionV3 }
  | { ok: false; error: string }

export function parseWorkflowDefinition(value: unknown): WorkflowDefinitionResult {
  // Workflow Agents always use Moss's active session model. Older V3 drafts
  // may contain legacy model/effort overrides; strip them when reading so
  // they remain usable without leaking stale provider names back into the UI.
  const parsed = workflowDefinitionSchema.safeParse(stripLegacyAgentOverrides(value))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? `definition.${issue.path.join('.')}: ` : ''
    return { ok: false, error: `${path}${issue?.message ?? 'Invalid workflow definition'}` }
  }
  const error = validateWorkflowDefinition(parsed.data)
  return error ? { ok: false, error } : { ok: true, definition: parsed.data }
}

function stripLegacyAgentOverrides(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const definition = { ...(value as Record<string, unknown>) }
  if (definition.defaults && typeof definition.defaults === 'object' && !Array.isArray(definition.defaults)) {
    const { model: _model, effort: _effort, ...defaults } = definition.defaults as Record<string, unknown>
    if (Object.keys(defaults).length > 0) definition.defaults = defaults
    else delete definition.defaults
  }
  if (definition.graph && typeof definition.graph === 'object' && !Array.isArray(definition.graph)) {
    definition.graph = stripLegacyOverridesFromGraph(definition.graph as Record<string, unknown>)
  }
  return definition
}

function stripLegacyOverridesFromGraph(graph: Record<string, unknown>): Record<string, unknown> {
  return {
    ...graph,
    ...(Array.isArray(graph.nodes)
      ? {
          nodes: graph.nodes.map(node => {
            if (!node || typeof node !== 'object' || Array.isArray(node)) return node
            const {
              model: _model,
              effort: _effort,
              stallMs: _stallMs,
              ...clean
            } = node as Record<string, unknown>
            if (clean.type === 'foreach' && clean.body && typeof clean.body === 'object' && !Array.isArray(clean.body)) {
              clean.body = stripLegacyOverridesFromGraph(clean.body as Record<string, unknown>)
            }
            return clean
          }),
        }
      : {}),
  }
}

export function parseWorkflowDefinitionJson(source: string): WorkflowDefinitionResult {
  if (Buffer.byteLength(source, 'utf8') > WORKFLOW_SCRIPT_MAX_BYTES) {
    return { ok: false, error: `Definition exceeds ${WORKFLOW_SCRIPT_MAX_BYTES} bytes` }
  }
  try {
    return parseWorkflowDefinition(JSON.parse(source))
  } catch (error) {
    return { ok: false, error: `Invalid workflow JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function stringifyWorkflowDefinition(definition: WorkflowDefinitionV3): string {
  return `${JSON.stringify(definition, null, 2)}\n`
}

export function walkWorkflowNodes(graph: WorkflowSubgraph, visit: (node: WorkflowNode) => void): void {
  for (const node of graph.nodes) {
    visit(node)
    if (node.type === 'foreach') walkWorkflowNodes(node.body, visit)
  }
}

function validateWorkflowDefinition(definition: WorkflowDefinitionV3): string | undefined {
  const globalIds = new Set<string>()
  let nodeCount = 0

  const visit = (
    graph: WorkflowSubgraph,
    path: string,
    kind: 'root' | 'foreach',
    ancestorIds: Set<string>,
  ): string | undefined => {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]))
    if (!nodes.has(graph.entry)) return `${path}.entry: unknown node "${graph.entry}"`

    const starts = graph.nodes.filter(node => node.type === 'start')
    const ends = graph.nodes.filter(node => node.type === 'end')
    if (kind === 'root') {
      if (starts.length !== 1) return `${path}: root graph requires exactly one start node`
      if (ends.length !== 1) return `${path}: root graph requires exactly one end node`
      if (graph.entry !== starts[0]!.id) return `${path}.entry must reference the start node`
    } else if (starts.length > 0 || ends.length > 0) {
      return `${path}: foreach bodies cannot contain start or end nodes`
    }

    for (let index = 0; index < graph.nodes.length; index++) {
      const node = graph.nodes[index]!
      nodeCount++
      if (nodeCount > MAX_DEFINITION_NODES) return `definition contains more than ${MAX_DEFINITION_NODES} nodes`
      if (globalIds.has(node.id)) return `${path}.nodes[${index}].id: duplicate node id "${node.id}"`
      globalIds.add(node.id)
      const ports = node.type === 'condition' || node.type === 'parallel'
        ? [...node.branches.map(branch => branch.port), ...(node.type === 'condition' ? [node.default.port] : [])]
        : []
      const duplicate = findDuplicate(ports)
      if (duplicate) return `${path}.nodes[${index}]: duplicate port "${duplicate}"`
      if (node.type === 'condition') {
        for (let branchIndex = 0; branchIndex < node.branches.length; branchIndex++) {
          const error = validatePredicateShape(node.branches[branchIndex]!.when, `${path}.nodes[${index}].branches[${branchIndex}].when`)
          if (error) return error
        }
      }
      const bindingError = validateBindingTargets(node, `${path}.nodes[${index}]`)
      if (bindingError) return bindingError
      if (node.type === 'foreach' && kind === 'foreach') {
        return `${path}.nodes[${index}]: nested foreach is not supported`
      }
    }

    const allowedTerminals = kind === 'foreach' ? new Set(['$complete']) : new Set<string>()
    const incomingForward = new Map<string, number>(graph.nodes.map(node => [node.id, 0]))
    const incomingAll = new Map<string, number>(graph.nodes.map(node => [node.id, 0]))
    const outgoing = new Map<string, WorkflowGraphEdge[]>(graph.nodes.map(node => [node.id, []]))
    const forwardAdjacency = new Map<string, string[]>(graph.nodes.map(node => [node.id, []]))
    const allAdjacency = new Map<string, string[]>(graph.nodes.map(node => [node.id, []]))
    const seenEdges = new Set<string>()

    for (let index = 0; index < graph.edges.length; index++) {
      const edge = graph.edges[index]!
      const edgePath = `${path}.edges[${index}]`
      const sourceNode = nodes.get(edge.source)
      if (!sourceNode) return `${edgePath}.source: unknown node "${edge.source}"`
      if (!nodes.has(edge.target) && !allowedTerminals.has(edge.target)) {
        return `${edgePath}.target: unknown node or terminal "${edge.target}"`
      }
      const key = `${edge.source}\0${edge.sourcePort ?? 'default'}\0${edge.target}`
      if (seenEdges.has(key)) return `${edgePath}: duplicate edge`
      seenEdges.add(key)
      const portError = validateSourcePort(sourceNode, edge.sourcePort)
      if (portError) return `${edgePath}.sourcePort: ${portError}`
      outgoing.get(edge.source)!.push(edge)
      if (nodes.has(edge.target)) {
        incomingAll.set(edge.target, incomingAll.get(edge.target)! + 1)
        allAdjacency.get(edge.source)!.push(edge.target)
        if (edge.kind !== 'back') {
          incomingForward.set(edge.target, incomingForward.get(edge.target)! + 1)
          forwardAdjacency.get(edge.source)!.push(edge.target)
        }
      }
    }

    if ((incomingAll.get(graph.entry) ?? 0) !== 0) return `${path}.entry must not have incoming edges`
    const cycle = findCycle(nodes.keys(), forwardAdjacency)
    if (cycle) return `${path}: every cycle must use an explicit bounded back edge; cycle includes "${cycle}"`

    for (let index = 0; index < graph.edges.length; index++) {
      const edge = graph.edges[index]!
      if (edge.kind !== 'back') continue
      if (!nodes.has(edge.target) || !canReach(edge.target, edge.source, forwardAdjacency)) {
        return `${path}.edges[${index}]: back edge must return to an earlier node on the same forward path`
      }
      if (nodes.get(edge.target)?.type === 'start') return `${path}.edges[${index}]: a back edge cannot target start`
    }

    for (const node of graph.nodes) {
      const nodeEdges = outgoing.get(node.id)!
      if (node.type === 'end') {
        if (nodeEdges.length !== 0) return `${path}: end node "${node.id}" cannot have outgoing edges`
      } else if (node.type === 'condition' || node.type === 'parallel') {
        const ports = node.type === 'condition'
          ? [...node.branches.map(branch => branch.port), node.default.port]
          : node.branches.map(branch => branch.port)
        for (const port of ports) {
          const count = nodeEdges.filter(edge => edge.sourcePort === port).length
          if (count !== 1) return `${path}: ${node.type} "${node.id}" port "${port}" must have exactly one outgoing edge`
        }
      } else {
        const defaults = nodeEdges.filter(edge => edge.sourcePort === undefined)
        if (defaults.length !== 1) return `${path}: node "${node.id}" must have exactly one default outgoing edge`
      }

      const forwardInputs = incomingForward.get(node.id) ?? 0
      if (node.id !== graph.entry && forwardInputs === 0) return `${path}: node "${node.id}" has no forward path from entry`
      if (!['join', 'merge'].includes(node.type) && node.id !== graph.entry && forwardInputs > 1) {
        return `${path}: node "${node.id}" has multiple forward inputs; use merge or join explicitly`
      }
      if (node.type === 'parallel') {
        const joins = graph.nodes.filter(candidate => candidate.type === 'join' && candidate.parallelId === node.id)
        if (joins.length !== 1) return `${path}: parallel "${node.id}" requires exactly one matching join`
      }
      if (node.type === 'join') {
        const split = nodes.get(node.parallelId)
        if (split?.type !== 'parallel') return `${path}: join "${node.id}" references unknown parallel "${node.parallelId}"`
        for (const branch of split.branches) {
          const branchEdge = outgoing.get(split.id)!.find(edge => edge.sourcePort === branch.port)!
          if (!nodes.has(branchEdge.target) || !canReach(branchEdge.target, node.id, forwardAdjacency)) {
            return `${path}: parallel "${split.id}" branch "${branch.port}" cannot reach join "${node.id}"`
          }
        }
      }
    }

    const reachable = reachableFrom(graph.entry, allAdjacency)
    if (reachable.size !== nodes.size) return `${path}: graph contains unreachable nodes`
    if (kind === 'root') {
      const endId = ends[0]!.id
      for (const node of graph.nodes) {
        if (!canReach(node.id, endId, allAdjacency)) return `${path}: node "${node.id}" cannot reach end node "${endId}"`
      }
    } else {
      if (!graph.edges.some(edge => edge.target === '$complete')) return `${path}: foreach body has no $complete edge`
      for (const node of graph.nodes) {
        if (!canReachTerminal(node.id, allAdjacency, outgoing, allowedTerminals)) {
          return `${path}: node "${node.id}" cannot reach $complete`
        }
      }
    }

    for (let index = 0; index < graph.nodes.length; index++) {
      const node = graph.nodes[index]!
      const upstreamIds = new Set([
        ...ancestorIds,
        ...[...nodes.keys()].filter(candidate => candidate !== node.id && canReach(candidate, node.id, forwardAdjacency)),
      ])
      for (const [sourcePath, source] of nodeSources(node)) {
        const availableIds = sourcePath.startsWith('output[') && node.type === 'foreach'
          ? new Set([...upstreamIds, ...node.body.nodes.map(child => child.id)])
          : upstreamIds
        const error = validateSource(source, `${path}.nodes[${index}].${sourcePath}`, availableIds, kind)
        if (error) return error
      }
      if (node.type === 'foreach') {
        const error = visit(
          node.body,
          `${path}.nodes[${index}].body`,
          'foreach',
          new Set([...ancestorIds, ...nodes.keys()]),
        )
        if (error) return error
      }
    }
    return undefined
  }

  return visit(definition.graph, 'definition.graph', 'root', new Set())
}

function validateBindingTargets(node: WorkflowNode, nodePath: string): string | undefined {
  const groups: Array<[string, WorkflowInputBinding[] | undefined]> = []
  if ('input' in node) groups.push(['input', node.input])
  if (node.type === 'foreach') groups.push(['output', node.output])
  for (const [name, bindings] of groups) {
    if (!bindings) continue
    for (let left = 0; left < bindings.length; left++) {
      for (let right = left + 1; right < bindings.length; right++) {
        if (pathsOverlap(bindings[left]!.target, bindings[right]!.target)) {
          return `${nodePath}.${name}: binding targets overlap`
        }
      }
    }
  }
  return undefined
}

function pathsOverlap(left: string[], right: string[]): boolean {
  const length = Math.min(left.length, right.length)
  return left.slice(0, length).every((value, index) => value === right[index])
}

function validateSourcePort(node: WorkflowNode, port: string | undefined): string | undefined {
  if (node.type === 'condition') {
    if (!port) return 'condition edges require sourcePort'
    const valid = node.branches.some(branch => branch.port === port) || node.default.port === port
    return valid ? undefined : `unknown condition port "${port}"`
  }
  if (node.type === 'parallel') {
    if (!port) return 'parallel edges require sourcePort'
    return node.branches.some(branch => branch.port === port) ? undefined : `unknown parallel port "${port}"`
  }
  return port === undefined ? undefined : `node type "${node.type}" does not expose port "${port}"`
}

function validatePredicateShape(predicate: WorkflowPredicate, path: string): string | undefined {
  if ('all' in predicate) {
    for (let index = 0; index < predicate.all.length; index++) {
      const error = validatePredicateShape(predicate.all[index]!, `${path}.all[${index}]`)
      if (error) return error
    }
    return undefined
  }
  if ('any' in predicate) {
    for (let index = 0; index < predicate.any.length; index++) {
      const error = validatePredicateShape(predicate.any[index]!, `${path}.any[${index}]`)
      if (error) return error
    }
    return undefined
  }
  if ('not' in predicate) return validatePredicateShape(predicate.not, `${path}.not`)
  const unary = ['is-empty', 'is-not-empty', 'exists', 'not-exists'].includes(predicate.operator)
  if (!unary && predicate.right === undefined) return `${path}: operator "${predicate.operator}" requires right`
  if (unary && predicate.right !== undefined) return `${path}: operator "${predicate.operator}" does not accept right`
  return undefined
}

function validateSource(
  source: WorkflowValueSource,
  path: string,
  nodeIds: Set<string>,
  kind: 'root' | 'foreach',
): string | undefined {
  if (source.kind === 'node-output' && !nodeIds.has(source.nodeId)) return `${path}: unknown node "${source.nodeId}"`
  if ((source.kind === 'iteration-item' || source.kind === 'iteration-index') && kind !== 'foreach') {
    return `${path}: ${source.kind} is only available inside foreach`
  }
  return undefined
}

function nodeSources(node: WorkflowNode): Array<[string, WorkflowValueSource]> {
  const sources: Array<[string, WorkflowValueSource]> = []
  if ('input' in node) {
    node.input?.forEach((binding, index) => sources.push([`input[${index}].source`, binding.source]))
  }
  if (node.type === 'condition') collectPredicateSources(node.branches.map(branch => branch.when), sources)
  if (node.type === 'merge') node.sources.forEach((source, index) => sources.push([`sources[${index}]`, source]))
  if (node.type === 'foreach') {
    sources.push(['items', node.items])
    node.output?.forEach((binding, index) => sources.push([`output[${index}].source`, binding.source]))
  }
  return sources
}

function collectPredicateSources(predicates: WorkflowPredicate[], output: Array<[string, WorkflowValueSource]>): void {
  const visit = (predicate: WorkflowPredicate, path: string): void => {
    if ('all' in predicate) predicate.all.forEach((item, index) => visit(item, `${path}.all[${index}]`))
    else if ('any' in predicate) predicate.any.forEach((item, index) => visit(item, `${path}.any[${index}]`))
    else if ('not' in predicate) visit(predicate.not, `${path}.not`)
    else {
      output.push([`${path}.left`, predicate.left])
      if (predicate.right) output.push([`${path}.right`, predicate.right])
    }
  }
  predicates.forEach((predicate, index) => visit(predicate, `branches[${index}].when`))
}

function reachableFrom(start: string, adjacency: Map<string, string[]>): Set<string> {
  const result = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (result.has(current)) continue
    result.add(current)
    queue.push(...(adjacency.get(current) ?? []))
  }
  return result
}

function canReach(start: string, target: string, adjacency: Map<string, string[]>): boolean {
  return reachableFrom(start, adjacency).has(target)
}

function canReachTerminal(
  start: string,
  adjacency: Map<string, string[]>,
  outgoing: Map<string, WorkflowGraphEdge[]>,
  terminals: Set<string>,
): boolean {
  const reachable = reachableFrom(start, adjacency)
  return [...reachable].some(node => outgoing.get(node)?.some(edge => terminals.has(edge.target)))
}

function findCycle(nodes: Iterable<string>, adjacency: Map<string, string[]>): string | undefined {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: string): string | undefined => {
    if (visiting.has(node)) return node
    if (visited.has(node)) return undefined
    visiting.add(node)
    for (const next of adjacency.get(node) ?? []) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    visiting.delete(node)
    visited.add(node)
    return undefined
  }
  for (const node of nodes) {
    const cycle = visit(node)
    if (cycle) return cycle
  }
  return undefined
}

function findDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function isHumanReadableTitle(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/=>|===|!==|&&|\|\||\b(?:const|let|var|return|function)\b|[;{}]/.test(trimmed)) return false
  if (/^[\w$.]+\([^)]*\)$/.test(trimmed)) return false
  return true
}
