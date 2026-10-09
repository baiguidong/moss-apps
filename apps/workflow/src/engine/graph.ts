import type {
  WorkflowDefinitionV3,
  WorkflowGraphEdge as DefinitionEdge,
  WorkflowNode,
  WorkflowSubgraph,
} from './definition.js'

export type WorkflowGraphNodeType =
  | 'start'
  | 'end'
  | 'agent'
  | 'code'
  | 'condition'
  | 'workflow'
  | 'merge'
  | 'parallel'
  | 'join'
  | 'foreach'

export type WorkflowGraphEdgeType =
  | 'next'
  | 'true'
  | 'false'
  | 'case'
  | 'loop-back'
  | 'fan-out'
  | 'join'

export type WorkflowGraphNode = {
  id: string
  workflowNodeId: string
  type: WorkflowGraphNodeType
  label: string
  detail?: string
}

export type WorkflowGraphEdge = {
  id: string
  source: string
  target: string
  type: WorkflowGraphEdgeType
  label?: string
  branchKey?: string
  workflowEdgeId?: string
}

export type WorkflowGraph = {
  version: 3
  name: string
  title: string
  description: string
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  warnings: Array<'truncated'>
}

type Endpoint = { nodeId: string; port?: string; label?: string }
type Projection = { entries: string[]; exits: Endpoint[] }

const MAX_GRAPH_NODES = 512
const MAX_GRAPH_EDGES = 2_048

export const WORKFLOW_START_NODE_ID = '$start'
export const WORKFLOW_END_NODE_ID = '$end'

export type WorkflowGraphResult =
  | { graph: WorkflowGraph; mermaid: string }
  | { error: string }

export function buildWorkflowGraph(definition: WorkflowDefinitionV3): WorkflowGraphResult {
  try {
    const graph = new WorkflowGraphBuilder(definition).build()
    return { graph, mermaid: workflowGraphToMermaid(graph) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function workflowGraphToMermaid(graph: WorkflowGraph): string {
  const lines = ['flowchart TD']
  for (const node of graph.nodes) lines.push(renderMermaidNode(node))
  for (const edge of graph.edges) {
    const arrow = edge.type === 'loop-back' ? '-.->' : '-->'
    lines.push(edge.label
      ? `  ${edge.source} ${arrow}|"${escapeMermaidLabel(edge.label)}"| ${edge.target}`
      : `  ${edge.source} ${arrow} ${edge.target}`)
  }
  return lines.join('\n')
}

function renderMermaidNode(node: WorkflowGraphNode): string {
  const label = escapeMermaidLabel(node.label)
  if (node.type === 'start' || node.type === 'end') return `  ${node.id}(["${label}"])`
  if (node.type === 'condition') return `  ${node.id}{"${label}"}`
  if (node.type === 'code') return `  ${node.id}[["${label}"]]`
  if (node.type === 'foreach') return `  ${node.id}{{"${label}"}}`
  return `  ${node.id}["${label}"]`
}

class WorkflowGraphBuilder {
  private readonly nodes: WorkflowGraphNode[] = []
  private readonly edges: WorkflowGraphEdge[] = []
  private readonly nodeGraphId = new Map<string, string>()
  private readonly projection = new Map<string, Projection>()
  private nodeSequence = 0
  private edgeSequence = 0
  private truncated = false

  constructor(private readonly definition: WorkflowDefinitionV3) {}

  build(): WorkflowGraph {
    this.projectSubgraph(this.definition.graph, 'root')
    this.classifyParallelEdges()
    return {
      version: 3,
      name: this.definition.meta.name,
      title: this.definition.meta.title,
      description: this.definition.meta.description,
      nodes: this.nodes,
      edges: this.edges,
      warnings: this.truncated ? ['truncated'] : [],
    }
  }

  private classifyParallelEdges(): void {
    const outgoing = new Map<string, number>()
    const incoming = new Map<string, number>()
    for (const edge of this.edges) {
      // A control-flow back edge is a loop, not a forward fan-in/fan-out.
      // Counting it here mislabels the ordinary entry into a loop as a join.
      if (edge.type === 'loop-back') continue
      outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    }
    for (const edge of this.edges) {
      if (edge.type !== 'next') continue
      if ((outgoing.get(edge.source) ?? 0) > 1) edge.type = 'fan-out'
      else if ((incoming.get(edge.target) ?? 0) > 1) edge.type = 'join'
    }
  }

  private projectSubgraph(graph: WorkflowSubgraph, kind: 'root' | 'foreach'): Projection {
    for (const node of graph.nodes) this.projectNode(node)
    const terminalExits = new Map<string, Endpoint[]>()
    for (const edge of graph.edges) {
      const source = this.sourceEndpoints(edge.source, edge.sourcePort)
      if (edge.target.startsWith('$')) {
        const list = terminalExits.get(edge.target) ?? []
        list.push(...source.map(endpoint => ({ ...endpoint, label: edge.label ?? this.portLabel(edge.source, edge.sourcePort) })))
        terminalExits.set(edge.target, list)
        continue
      }
      const targets = this.targetEntries(edge.target)
      for (const from of source) {
        for (const target of targets) {
          this.addEdge(
            from.nodeId,
            target,
            this.edgeType(edge),
            edge.label ?? from.label ?? this.portLabel(edge.source, edge.sourcePort),
            edge.sourcePort ?? from.port,
            definitionEdgeId(edge),
          )
        }
      }
    }

    const entry = this.targetEntries(graph.entry)
    if (kind === 'foreach') {
      for (const endpoint of terminalExits.get('$complete') ?? []) {
        for (const target of entry) {
          this.addEdge(
            endpoint.nodeId,
            target,
            'loop-back',
            '下一项',
            endpoint.port ?? 'complete',
            `${this.workflowNodeId(endpoint.nodeId)}:${endpoint.port ?? 'default'}->$complete`,
          )
        }
      }
      return { entries: entry, exits: terminalExits.get('$complete') ?? [] }
    }
    const end = graph.nodes.find(node => node.type === 'end')
    return { entries: entry, exits: end ? this.sourceEndpoints(end.id) : [] }
  }

  private projectNode(node: WorkflowNode): void {
    if (this.projection.has(node.id)) return
    if (node.type === 'foreach') {
      const graphId = this.addNode(node)
      this.nodeGraphId.set(node.id, graphId)
      const body = this.projectSubgraph(node.body, node.type)
      for (const entry of body.entries) {
        this.addEdge(
          graphId,
          entry,
          'next',
          '每一项',
          'item',
          `${node.id}:item->${this.workflowNodeId(entry)}`,
        )
      }
      this.projection.set(node.id, { entries: [graphId], exits: body.exits })
      return
    }
    const graphId = this.addNode(node)
    this.nodeGraphId.set(node.id, graphId)
    this.projection.set(node.id, { entries: [graphId], exits: [{ nodeId: graphId }] })
  }

  private targetEntries(nodeId: string): string[] {
    return this.projection.get(nodeId)?.entries ?? []
  }

  private sourceEndpoints(nodeId: string, port?: string): Endpoint[] {
    const projected = this.projection.get(nodeId)
    if (!projected) return []
    if (projected.exits.length > 0 && !this.nodeGraphId.has(nodeId)) return projected.exits
    return projected.exits.map(endpoint => ({ ...endpoint, ...(port ? { port } : {}) }))
  }

  private portLabel(nodeId: string, port?: string): string | undefined {
    if (!port) return undefined
    const find = (graph: WorkflowSubgraph): WorkflowNode | undefined => {
      for (const node of graph.nodes) {
        if (node.id === nodeId) return node
        if (node.type === 'foreach') {
          const nested = find(node.body)
          if (nested) return nested
        }
      }
      return undefined
    }
    const node = find(this.definition.graph)
    if (node?.type === 'parallel') return node.branches.find(branch => branch.port === port)?.label
    if (node?.type !== 'condition') return undefined
    return node.branches.find(branch => branch.port === port)?.label ?? (node.default.port === port ? node.default.label : undefined)
  }

  private edgeType(edge: DefinitionEdge): WorkflowGraphEdgeType {
    if (edge.kind === 'back') return 'loop-back'
    const source = this.findNode(edge.source)
    const target = this.findNode(edge.target)
    if (source?.type === 'parallel') return 'fan-out'
    if (target?.type === 'join') return 'join'
    if (!edge.sourcePort) return 'next'
    const label = this.portLabel(edge.source, edge.sourcePort)
    if (label === '是') return 'true'
    if (label === '否') return 'false'
    return 'case'
  }

  private findNode(nodeId: string): WorkflowNode | undefined {
    const find = (graph: WorkflowSubgraph): WorkflowNode | undefined => {
      for (const node of graph.nodes) {
        if (node.id === nodeId) return node
        if (node.type === 'foreach') {
          const nested = find(node.body)
          if (nested) return nested
        }
      }
      return undefined
    }
    return find(this.definition.graph)
  }

  private addNode(node: WorkflowNode): string {
    if (this.nodes.length >= MAX_GRAPH_NODES) {
      this.truncated = true
      return `n${this.nodeSequence}`
    }
    const id = `n${++this.nodeSequence}`
    const detail = node.type === 'code'
      ? 'JavaScript'
      : node.type === 'foreach'
        ? node.description ?? '对输入数组逐项执行内部步骤'
        : node.description
    this.nodes.push({
      id,
      workflowNodeId: node.id,
      type: node.type,
      label: node.title,
      ...(detail ? { detail } : {}),
    })
    return id
  }

  private workflowNodeId(graphNodeId: string): string {
    return this.nodes.find(node => node.id === graphNodeId)?.workflowNodeId ?? graphNodeId
  }

  private addEdge(source: string, target: string, type: WorkflowGraphEdgeType, label?: string, branchKey?: string, workflowEdgeId?: string): void {
    if (this.edges.length >= MAX_GRAPH_EDGES) { this.truncated = true; return }
    if (!source || !target) return
    const duplicate = this.edges.some(edge => edge.source === source && edge.target === target && edge.type === type && edge.label === label)
    if (duplicate) return
    this.edges.push({
      id: `e${++this.edgeSequence}`,
      source,
      target,
      type,
      ...(label ? { label } : {}),
      ...(branchKey ? { branchKey } : {}),
      ...(workflowEdgeId ? { workflowEdgeId } : {}),
    })
  }
}

function definitionEdgeId(edge: DefinitionEdge): string {
  return `${edge.source}:${edge.sourcePort ?? 'default'}->${edge.target}`
}

function escapeMermaidLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/`/g, '&#96;')
    .replace(/\|/g, '&#124;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ')
}
