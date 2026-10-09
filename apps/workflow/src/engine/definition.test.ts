import { describe, expect, test } from 'bun:test'
import {
  parseWorkflowDefinition,
  parseWorkflowDefinitionJson,
  type WorkflowDefinitionV3,
} from './definition.js'

const OBJECT = { type: 'object' }

const BASE: WorkflowDefinitionV3 = {
  version: 3,
  kind: 'state-machine',
  meta: { name: 'demo', title: 'Demo', description: 'A demo' },
  graph: {
    entry: 'input',
    nodes: [
      { id: 'input', type: 'start', title: '输入', outputSchema: OBJECT },
      { id: 'work', type: 'code', title: '处理数据', language: 'javascript', script: 'return input', outputSchema: OBJECT },
      { id: 'output', type: 'end', title: '输出', inputSchema: OBJECT, input: [{ target: [], source: { kind: 'node-output', nodeId: 'work' } }] },
    ],
    edges: [{ source: 'input', target: 'work' }, { source: 'work', target: 'output' }],
  },
}

describe('workflow definition v3', () => {
  test('accepts an explicit state-machine definition', () => {
    expect(parseWorkflowDefinition(BASE)).toMatchObject({ ok: true })
  })

  test('removes legacy runtime tuning fields and inherits Moss runtime settings', () => {
    const legacy = structuredClone(BASE) as unknown as Record<string, any>
    legacy.defaults = { model: 'legacy-model-a', effort: 'high', concurrency: 2 }
    legacy.graph.nodes.splice(1, 0, {
      id: 'agent', type: 'agent', title: '处理文本', prompt: '处理', outputSchema: OBJECT,
      model: 'legacy-model-b', effort: 'low', stallMs: 12_000,
    })
    legacy.graph.edges = [
      { source: 'input', target: 'agent' },
      { source: 'agent', target: 'work' },
      { source: 'work', target: 'output' },
    ]

    const parsed = parseWorkflowDefinition(legacy)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.definition.defaults).toEqual({ concurrency: 2 })
    expect(parsed.definition.graph.nodes.find(node => node.id === 'agent')).not.toHaveProperty('model')
    expect(parsed.definition.graph.nodes.find(node => node.id === 'agent')).not.toHaveProperty('effort')
    expect(parsed.definition.graph.nodes.find(node => node.id === 'agent')).not.toHaveProperty('stallMs')
  })

  test('rejects v2 definitions', () => {
    expect(parseWorkflowDefinition({ version: 2, kind: 'graph', graph: {} })).toEqual({
      ok: false,
      error: expect.stringContaining('version'),
    })
  })

  test('requires every cycle to use a bounded back edge', () => {
    const unmarked = structuredClone(BASE)
    unmarked.graph.edges = [
      { source: 'input', target: 'work' },
      { source: 'work', target: 'work' },
      { source: 'work', target: 'output' },
    ]
    expect(parseWorkflowDefinition(unmarked)).toEqual({ ok: false, error: expect.any(String) })

    const value = structuredClone(BASE)
    value.graph.nodes.splice(2, 0, {
      id: 'check', type: 'condition', title: '是否继续？',
      branches: [{
        port: 'yes', label: '是',
        when: { left: { kind: 'literal', value: false }, operator: 'equals', right: { kind: 'literal', value: true } },
      }],
      default: { port: 'no', label: '否' },
    })
    value.graph.edges = [
      { source: 'input', target: 'work' },
      { source: 'work', target: 'check' },
      { source: 'check', sourcePort: 'yes', target: 'work', kind: 'back', maxTraversals: 3 },
      { source: 'check', sourcePort: 'no', target: 'output' },
    ]
    expect(parseWorkflowDefinition(value)).toMatchObject({ ok: true })
  })

  test('requires every condition port to have exactly one edge', () => {
    const value = structuredClone(BASE)
    value.graph.nodes.splice(1, 0, {
      id: 'check', type: 'condition', title: '是否继续？',
      branches: [{
        port: 'yes', label: '是',
        when: { left: { kind: 'literal', value: true }, operator: 'equals', right: { kind: 'literal', value: true } },
      }],
      default: { port: 'no', label: '否' },
    })
    value.graph.edges = [{ source: 'input', target: 'check' }, { source: 'check', sourcePort: 'yes', target: 'work' }, { source: 'work', target: 'output' }]
    expect(parseWorkflowDefinition(value)).toEqual({ ok: false, error: expect.stringContaining('port "no"') })
  })

  test('requires foreach outputSchema to describe the result array', () => {
    const value = {
      version: 3,
      kind: 'state-machine',
      meta: { name: 'foreach-demo', title: '遍历演示', description: '逐项处理输入' },
      graph: {
        entry: 'input',
        nodes: [
          {
            id: 'input', type: 'start', title: '输入',
            outputSchema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'string' } } } },
          },
          {
            id: 'each', type: 'foreach', title: '遍历内容',
            items: { kind: 'workflow-input', path: ['items'] },
            body: {
              entry: 'copy',
              nodes: [{
                id: 'copy', type: 'code', title: '复制当前项', language: 'javascript', script: 'return input',
                input: [{ target: [], source: { kind: 'iteration-item' } }],
                outputSchema: { type: 'string' },
              }],
              edges: [{ source: 'copy', target: '$complete' }],
            },
            output: [{ target: [], source: { kind: 'node-output', nodeId: 'copy' } }],
            outputSchema: { type: 'object' },
          },
          {
            id: 'output', type: 'end', title: '输出', inputSchema: { type: 'array' },
            input: [{ target: [], source: { kind: 'node-output', nodeId: 'each' } }],
          },
        ],
        edges: [{ source: 'input', target: 'each' }, { source: 'each', target: 'output' }],
      },
    }

    expect(parseWorkflowDefinition(value)).toEqual({
      ok: false,
      error: expect.stringContaining('foreach outputSchema must declare type="array"'),
    })
    value.graph.nodes[1]!.outputSchema = { type: 'array', items: { type: 'string' } }
    expect(parseWorkflowDefinition(value)).toMatchObject({ ok: true })
  })

  test('treats one IF branch plus the mandatory default as two complete routes', () => {
    const value = structuredClone(BASE)
    value.graph.nodes.splice(1, 0, {
      id: 'route', type: 'condition', title: '是否继续？',
      branches: [{
        port: 'yes', label: '继续',
        when: { left: { kind: 'literal', value: true }, operator: 'equals', right: { kind: 'literal', value: true } },
      }],
      default: { port: 'no', label: '结束' },
    })
    value.graph.edges = [
      { source: 'input', target: 'route' },
      { source: 'route', sourcePort: 'yes', target: 'work' },
      { source: 'route', sourcePort: 'no', target: 'output' },
      { source: 'work', target: 'output' },
    ]

    // The two routes later converge at End, which must be made explicit with
    // a merge node rather than relying on an ambiguous multi-input node.
    expect(parseWorkflowDefinition(value)).toEqual({
      ok: false,
      error: expect.stringContaining('multiple forward inputs'),
    })
    value.graph.nodes.splice(-1, 0, {
      id: 'merge', type: 'merge', title: '选择结果', mode: 'first-available',
      sources: [
        { kind: 'node-output', nodeId: 'work' },
        { kind: 'literal', value: {} },
      ],
      outputSchema: OBJECT,
    })
    value.graph.edges = [
      { source: 'input', target: 'route' },
      { source: 'route', sourcePort: 'yes', target: 'work' },
      { source: 'route', sourcePort: 'no', target: 'merge' },
      { source: 'work', target: 'merge' },
      { source: 'merge', target: 'output' },
    ]
    expect(parseWorkflowDefinition(value)).toMatchObject({ ok: true })
  })

  test('requires explicit parallel and join nodes for fan-out', () => {
    const invalid = structuredClone(BASE)
    invalid.graph.nodes.splice(1, 1,
      { id: 'left', type: 'code', title: '左侧处理', language: 'javascript', script: 'return {}', outputSchema: OBJECT },
      { id: 'right', type: 'code', title: '右侧处理', language: 'javascript', script: 'return {}', outputSchema: OBJECT },
    )
    invalid.graph.edges = [
      { source: 'input', target: 'left' },
      { source: 'input', target: 'right' },
      { source: 'left', target: 'output' },
      { source: 'right', target: 'output' },
    ]
    expect(parseWorkflowDefinition(invalid)).toEqual({ ok: false, error: expect.stringContaining('exactly one default outgoing edge') })

    const valid: WorkflowDefinitionV3 = {
      ...structuredClone(BASE),
      graph: {
        entry: 'input',
        nodes: [
          { id: 'input', type: 'start', title: '输入', outputSchema: OBJECT },
          { id: 'split', type: 'parallel', title: '并行分析', branches: [{ port: 'left', label: '左侧' }, { port: 'right', label: '右侧' }] },
          { id: 'left', type: 'code', title: '左侧处理', language: 'javascript', script: 'return {}', outputSchema: OBJECT },
          { id: 'right', type: 'code', title: '右侧处理', language: 'javascript', script: 'return {}', outputSchema: OBJECT },
          { id: 'join', type: 'join', title: '汇合结果', parallelId: 'split' },
          { id: 'output', type: 'end', title: '输出', inputSchema: OBJECT, input: [{ target: [], source: { kind: 'literal', value: {} } }] },
        ],
        edges: [
          { source: 'input', target: 'split' },
          { source: 'split', sourcePort: 'left', target: 'left' },
          { source: 'split', sourcePort: 'right', target: 'right' },
          { source: 'left', target: 'join' },
          { source: 'right', target: 'join' },
          { source: 'join', target: 'output' },
        ],
      },
    }
    expect(parseWorkflowDefinition(valid)).toMatchObject({ ok: true })
  })

  test('rejects unknown references and malformed JSON', () => {
    const value = structuredClone(BASE)
    const work = value.graph.nodes[1]
    if (work.type !== 'code') throw new Error('fixture')
    work.input = [{ target: ['bad'], source: { kind: 'node-output', nodeId: 'missing' } }]
    expect(parseWorkflowDefinition(value)).toEqual({ ok: false, error: expect.stringContaining('unknown node "missing"') })
    expect(parseWorkflowDefinitionJson('{"version": 3,')).toEqual({ ok: false, error: expect.stringContaining('Invalid workflow JSON') })
  })

  test('rejects code-like titles and overlapping binding targets', () => {
    const codeTitle = structuredClone(BASE)
    codeTitle.graph.nodes[1]!.title = "confirmed.some(f => f.severity === 'critical')"
    expect(parseWorkflowDefinition(codeTitle)).toEqual({ ok: false, error: expect.stringContaining('human-readable') })

    const overlapping = structuredClone(BASE)
    const work = overlapping.graph.nodes[1]
    if (work.type !== 'code') throw new Error('fixture')
    work.input = [
      { target: [], source: { kind: 'workflow-input' } },
      { target: ['value'], source: { kind: 'workflow-input', path: ['value'] } },
    ]
    expect(parseWorkflowDefinition(overlapping)).toEqual({ ok: false, error: expect.stringContaining('overlap') })
  })
})
