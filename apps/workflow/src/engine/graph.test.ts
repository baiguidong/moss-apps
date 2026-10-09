import { describe, expect, test } from 'bun:test'
import type { WorkflowDefinitionV3 } from './definition.js'
import { buildWorkflowGraph, workflowGraphToMermaid } from './graph.js'

const DEFINITION: WorkflowDefinitionV3 = {
  version: 3,
  kind: 'state-machine',
  meta: { name: 'review', title: 'Review', description: 'Review loop' },
  graph: {
    entry: 'input',
    nodes: [
      { id: 'input', type: 'start', title: '开始', outputSchema: {} },
      { id: 'review', type: 'agent', title: 'Review 代码', prompt: 'review', outputSchema: {} },
      {
        id: 'check', type: 'condition', title: '是否发现问题？',
        branches: [{ port: 'yes', label: '是', when: { left: { kind: 'literal', value: true }, operator: 'equals', right: { kind: 'literal', value: true } } }],
        default: { port: 'no', label: '否' },
      },
      { id: 'fix', type: 'agent', title: '修复问题', prompt: 'fix', outputSchema: {} },
      { id: 'output', type: 'end', title: '结束', inputSchema: {}, input: [{ target: [], source: { kind: 'node-output', nodeId: 'review' } }] },
    ],
    edges: [
      { source: 'input', target: 'review' },
      { source: 'review', target: 'check' },
      { source: 'check', sourcePort: 'yes', target: 'fix', label: '是' },
      { source: 'fix', target: 'review', kind: 'back', maxTraversals: 3, label: '再次 Review' },
      { source: 'check', sourcePort: 'no', target: 'output', label: '否' },
    ],
  },
}

describe('workflow graph projection', () => {
  test('renders a Definition back edge directly without a loop box', () => {
    const result = buildWorkflowGraph(DEFINITION)
    if ('error' in result) throw new Error(result.error)
    expect(result.graph.nodes.map(node => node.workflowNodeId)).toEqual(['input', 'review', 'check', 'fix', 'output'])
    expect(result.graph.edges).toContainEqual(expect.objectContaining({ type: 'loop-back', label: '再次 Review' }))
    expect(result.graph.edges.find(edge => edge.workflowEdgeId === 'input:default->review')?.type).toBe('next')
  })

  test('escapes labels safely', () => {
    const result = buildWorkflowGraph(DEFINITION)
    if ('error' in result) throw new Error(result.error)
    result.graph.nodes[1]!.label = 'Review `a` <b> "c"'
    expect(workflowGraphToMermaid(result.graph)).toContain('Review &#96;a&#96; &lt;b&gt; &quot;c&quot;')
  })

  test('keeps a foreach container visible while showing its body', () => {
    const definition: WorkflowDefinitionV3 = {
      version: 3,
      kind: 'state-machine',
      meta: { name: 'batch', title: '批量处理', description: '逐项处理输入' },
      graph: {
        entry: 'input',
        nodes: [
          { id: 'input', type: 'start', title: '输入列表', outputSchema: { type: 'object' } },
          {
            id: 'items', type: 'foreach', title: '遍历项目',
            items: { kind: 'workflow-input', path: ['items'] },
            outputSchema: { type: 'array' },
            body: {
              entry: 'process-item',
              nodes: [{
                id: 'process-item', type: 'code', title: '处理当前项目', language: 'javascript',
                script: 'return item', outputSchema: {},
              }],
              edges: [{ source: 'process-item', target: '$complete' }],
            },
          },
          {
            id: 'output', type: 'end', title: '输出结果', inputSchema: { type: 'array' },
            input: [{ target: [], source: { kind: 'node-output', nodeId: 'items' } }],
          },
        ],
        edges: [{ source: 'input', target: 'items' }, { source: 'items', target: 'output' }],
      },
    }
    const result = buildWorkflowGraph(definition)
    if ('error' in result) throw new Error(result.error)

    expect(result.graph.nodes.map(node => [node.workflowNodeId, node.type])).toEqual([
      ['input', 'start'],
      ['items', 'foreach'],
      ['process-item', 'code'],
      ['output', 'end'],
    ])
    expect(result.graph.edges).toContainEqual(expect.objectContaining({
      source: 'n2', target: 'n3', label: '每一项', branchKey: 'item',
    }))
    expect(result.mermaid).toContain('n2{{"遍历项目"}}')
  })
})
