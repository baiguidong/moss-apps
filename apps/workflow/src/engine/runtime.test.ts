import { describe, expect, test } from 'bun:test'
import type { WorkflowDefinitionV3, WorkflowNode } from './definition.js'
const createUserMessage = ({content}: {content: string}) => ({type: 'user', content})
import { executeWorkflowDefinition, prepareWorkflowDefinition } from './runtime.js'
import type { WorkflowAgentRunParams, WorkflowAgentRunResult } from './agent-executor.js'
import type { WorkflowProgressEvent } from './types.js'

const OBJECT = { type: 'object' }

function definition(middle: WorkflowNode[], edges: WorkflowDefinitionV3['graph']['edges']): WorkflowDefinitionV3 {
  return {
    version: 3,
    kind: 'state-machine',
    meta: { name: 'demo', title: 'Demo', description: 'A demo' },
    graph: {
      entry: 'input',
      nodes: [
        { id: 'input', type: 'start', title: '输入', outputSchema: OBJECT },
        ...middle,
        { id: 'output', type: 'end', title: '输出', inputSchema: {}, input: [{ target: [], source: { kind: 'node-output', nodeId: middle.at(-1)?.id ?? 'input' } }] },
      ],
      edges,
    },
  }
}

async function run(
  value: WorkflowDefinitionV3,
  options: {
    agent?: (params: WorkflowAgentRunParams) => Promise<unknown>
    args?: unknown
    controller?: AbortController
    nested?: (
      reference: { workflowId?: string; name?: string; revision?: number },
      args: unknown,
      parentInstanceId: string,
    ) => Promise<unknown>
  } = {},
) {
  const prepared = prepareWorkflowDefinition(value)
  if (!prepared.ok) throw new Error(prepared.error)
  const events: WorkflowProgressEvent[] = []
  let sequence = 0
  const outcome = await executeWorkflowDefinition({
    prepared,
    signal: (options.controller ?? new AbortController()).signal,
    runId: 'wf_test0000-abc',
    args: options.args,
    onProgress: event => events.push(event),
    onAgentController: () => {},
    runNestedWorkflow: options.nested,
    runAgentImpl: async (params): Promise<WorkflowAgentRunResult> => {
      const priorId = params.conversation?.agentId ?? params.resumeAgentId
      return {
        agentId: priorId ?? `agent-${++sequence}`,
        value: options.agent ? await options.agent(params) : { status: 'completed', output: { prompt: params.prompt } },
        tokens: 10,
        toolCalls: 1,
        conversationMessages: [
          ...(params.conversation?.messages ?? []),
          createUserMessage({ content: `context from ${params.prompt}` }),
        ],
      }
    },
  })
  return { outcome, events }
}

describe('Workflow Definition v3 executor', () => {
  test('executes a linear graph and validates output', async () => {
    const value = definition([
      {
        id: 'double', type: 'code', title: '数字翻倍', language: 'javascript',
        input: [{ target: ['value'], source: { kind: 'workflow-input', path: ['value'] } }],
        inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'number' } } },
        outputSchema: { type: 'number' }, script: 'log(`doubling ${input.value}`); return input.value * 2',
      },
    ], [{ source: 'input', target: 'double' }, { source: 'double', target: 'output' }])
    const { outcome, events } = await run(value, { args: { value: 4 } })
    expect(outcome.status).toBe('completed')
    expect(outcome.result).toBe(8)
    expect(events).toContainEqual(expect.objectContaining({ type: 'workflow_log', message: 'doubling 4' }))
  })

  test('exposes only explicit bindings to Agent and code nodes', async () => {
    const prompts: string[] = []
    const value = definition([
      {
        id: 'inspect', type: 'agent', title: '检查公开输入', prompt: 'Inspect the provided value.',
        input: [{ target: ['visible'], source: { kind: 'workflow-input', path: ['visible'] } }],
        outputSchema: { type: 'object' },
      },
      {
        id: 'shape', type: 'code', title: '整理公开输入', language: 'javascript',
        input: [{ target: ['agent'], source: { kind: 'node-output', nodeId: 'inspect' } }],
        script: 'return { agent: input.agent, hasImplicitArgs: typeof args !== "undefined" }',
        outputSchema: { type: 'object' },
      },
    ], [
      { source: 'input', target: 'inspect' },
      { source: 'inspect', target: 'shape' },
      { source: 'shape', target: 'output' },
    ])

    const { outcome } = await run(value, {
      args: { visible: 'share-me', secret: 'must-not-leak' },
      agent: async params => {
        prompts.push(params.prompt)
        return { status: 'completed', output: { received: true } }
      },
    })

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('share-me')
    expect(prompts[0]).not.toContain('must-not-leak')
    expect(outcome.result).toEqual({ agent: { received: true }, hasImplicitArgs: false })
  })

  test('selects one condition branch and records exact edges', async () => {
    const value = definition([
      {
        id: 'check', type: 'condition', title: '是否启用？',
        branches: [{ port: 'yes', label: '是', when: { left: { kind: 'workflow-input', path: ['enabled'] }, operator: 'equals', right: { kind: 'literal', value: true } } }],
        default: { port: 'no', label: '否' },
      },
      { id: 'yes', type: 'code', title: '启用功能', language: 'javascript', script: 'return {result:"yes"}', outputSchema: OBJECT },
      { id: 'no', type: 'code', title: '禁用功能', language: 'javascript', script: 'return {result:"no"}', outputSchema: OBJECT },
      { id: 'merge', type: 'merge', title: '选择结果', mode: 'first-available', sources: [{ kind: 'node-output', nodeId: 'yes' }, { kind: 'node-output', nodeId: 'no' }], outputSchema: OBJECT },
    ], [
      { source: 'input', target: 'check' },
      { source: 'check', sourcePort: 'yes', target: 'yes' },
      { source: 'check', sourcePort: 'no', target: 'no' },
      { source: 'yes', target: 'merge' },
      { source: 'no', target: 'merge' },
      { source: 'merge', target: 'output' },
    ])
    const { outcome, events } = await run(value, { args: { enabled: true } })
    expect(outcome.result).toEqual({ result: 'yes' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'workflow_edge', source: 'check', target: 'yes', state: 'traversed' }))
    expect(events.some(event => event.type === 'workflow_node' && event.nodeId === 'no')).toBe(false)
  })

  test('runs an Agent-based routing workflow without scenario-specific control logic', async () => {
    const calls: string[] = []
    const value = definition([
      {
        id: 'classify', type: 'agent', title: '识别请求优先级', prompt: 'Classify the request priority.',
        input: [{ target: ['message'], source: { kind: 'workflow-input', path: ['message'] } }],
        outputSchema: {
          type: 'object', required: ['urgent'], properties: { urgent: { type: 'boolean' } },
        },
      },
      {
        id: 'route', type: 'condition', title: '是否紧急？',
        branches: [{
          port: 'urgent', label: '紧急',
          when: {
            left: { kind: 'node-output', nodeId: 'classify', path: ['urgent'] },
            operator: 'equals', right: { kind: 'literal', value: true },
          },
        }],
        default: { port: 'routine', label: '常规' },
      },
      {
        id: 'urgent-response', type: 'agent', title: '处理紧急请求', prompt: 'Handle the urgent request.',
        input: [{ target: ['message'], source: { kind: 'workflow-input', path: ['message'] } }],
        outputSchema: { type: 'object', required: ['response'], properties: { response: { type: 'string' } } },
      },
      {
        id: 'routine-response', type: 'agent', title: '处理常规请求', prompt: 'Handle the routine request.',
        input: [{ target: ['message'], source: { kind: 'workflow-input', path: ['message'] } }],
        outputSchema: { type: 'object', required: ['response'], properties: { response: { type: 'string' } } },
      },
      {
        id: 'result', type: 'merge', title: '汇总处理结果', mode: 'first-available',
        sources: [
          { kind: 'node-output', nodeId: 'urgent-response' },
          { kind: 'node-output', nodeId: 'routine-response' },
        ],
        outputSchema: { type: 'object' },
      },
    ], [
      { source: 'input', target: 'classify' },
      { source: 'classify', target: 'route' },
      { source: 'route', sourcePort: 'urgent', target: 'urgent-response' },
      { source: 'route', sourcePort: 'routine', target: 'routine-response' },
      { source: 'urgent-response', target: 'result' },
      { source: 'routine-response', target: 'result' },
      { source: 'result', target: 'output' },
    ])

    const { outcome } = await run(value, {
      args: { message: 'Payment failed twice.' },
      agent: async params => {
        const label = params.opts?.label ?? ''
        calls.push(label)
        if (label === '识别请求优先级') return { status: 'completed', output: { urgent: true } }
        return { status: 'completed', output: { response: 'Escalated' } }
      },
    })

    expect(outcome.status).toBe('completed')
    expect(outcome.result).toEqual({ response: 'Escalated' })
    expect(calls).toEqual(['识别请求优先级', '处理紧急请求'])
  })

  test('follows a bounded review back edge and reuses one contextual Agent per node', async () => {
    let reviews = 0
    const reviewSessions: Array<{ agentId?: string; contextMessages: number }> = []
    const value = definition([
      {
        id: 'review', type: 'agent', title: 'Review 代码', prompt: 'review',
        outputSchema: { type: 'object', required: ['clean'], properties: { clean: { type: 'boolean' } } },
      },
      {
        id: 'check', type: 'condition', title: '是否发现问题？',
        branches: [{ port: 'yes', label: '是', when: { left: { kind: 'node-output', nodeId: 'review', path: ['clean'] }, operator: 'equals', right: { kind: 'literal', value: false } } }],
        default: { port: 'no', label: '否' },
      },
      { id: 'fix', type: 'agent', title: '修复代码', prompt: 'fix', outputSchema: OBJECT },
      {
        id: 'done', type: 'code', title: '整理结果', language: 'javascript', script: 'return input',
        input: [{ target: [], source: { kind: 'node-output', nodeId: 'review' } }], outputSchema: OBJECT,
      },
    ], [
      { source: 'input', target: 'review' },
      { source: 'review', target: 'check' },
      { source: 'check', sourcePort: 'yes', target: 'fix' },
      { source: 'fix', target: 'review', kind: 'back', maxTraversals: 3 },
      { source: 'check', sourcePort: 'no', target: 'done' },
      { source: 'done', target: 'output' },
    ])
    const { outcome, events } = await run(value, {
      agent: async params => {
        if (params.prompt.startsWith('review')) {
          reviewSessions.push({
            agentId: params.conversation?.agentId ?? params.resumeAgentId,
            contextMessages: params.conversation?.messages.length ?? 0,
          })
          return { status: 'completed', output: { clean: ++reviews >= 2 } }
        }
        return { status: 'completed', output: { fixed: true } }
      },
    })
    expect(outcome.status).toBe('completed')
    expect(outcome.agentCount).toBe(2)
    expect(reviewSessions[0]).toEqual({ agentId: undefined, contextMessages: 0 })
    expect(reviewSessions[1]).toEqual({ agentId: 'agent-1', contextMessages: 1 })
    expect(events.filter(event => event.type === 'workflow_node' && event.nodeId === 'review' && event.state === 'completed')).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ type: 'workflow_node', nodeId: 'review', instanceId: 'review[2]' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'workflow_edge', source: 'fix', target: 'review', state: 'traversed' }))
  })

  test('completes the canonical review, report, plan, fix, re-review, test, and summary scenario', async () => {
    let reviewRuns = 0
    const calls: string[] = []
    const reviewContextSizes: number[] = []
    const value = definition([
      {
        id: 'review', type: 'agent', title: 'Review 代码', prompt: 'review',
        input: [{ target: ['target'], source: { kind: 'workflow-input', path: ['target'] } }],
        outputSchema: {
          type: 'object', required: ['hasIssues', 'issues', 'summary'],
          properties: {
            hasIssues: { type: 'boolean' },
            issues: { type: 'array', items: { type: 'object' } },
            summary: { type: 'string' },
          },
        },
      },
      {
        id: 'has-issues', type: 'condition', title: '是否发现问题？',
        branches: [{
          port: 'yes', label: '是',
          when: {
            left: { kind: 'node-output', nodeId: 'review', path: ['hasIssues'] },
            operator: 'equals', right: { kind: 'literal', value: true },
          },
        }],
        default: { port: 'no', label: '否' },
      },
      {
        id: 'report', type: 'agent', title: '生成问题报告', prompt: 'report',
        input: [{ target: ['review'], source: { kind: 'node-output', nodeId: 'review' } }],
        outputSchema: { type: 'object', required: ['report'], properties: { report: { type: 'string' } } },
      },
      {
        id: 'plan', type: 'agent', title: '制定修复 Plan', prompt: 'plan',
        input: [{ target: ['report'], source: { kind: 'node-output', nodeId: 'report' } }],
        outputSchema: { type: 'object', required: ['plan'], properties: { plan: { type: 'string' } } },
      },
      {
        id: 'fix', type: 'agent', title: '修复代码', prompt: 'fix',
        input: [{ target: ['plan'], source: { kind: 'node-output', nodeId: 'plan' } }],
        outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
      },
      {
        id: 'test', type: 'agent', title: '整体测试', prompt: 'test',
        input: [{ target: ['target'], source: { kind: 'workflow-input', path: ['target'] } }],
        outputSchema: { type: 'object', required: ['passed', 'summary'], properties: { passed: { type: 'boolean' }, summary: { type: 'string' } } },
      },
      {
        id: 'summary', type: 'agent', title: '总结结果', prompt: 'summary',
        input: [
          { target: ['review'], source: { kind: 'node-output', nodeId: 'review' } },
          { target: ['test'], source: { kind: 'node-output', nodeId: 'test' } },
        ],
        outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
      },
    ], [
      { source: 'input', target: 'review' },
      { source: 'review', target: 'has-issues' },
      { source: 'has-issues', sourcePort: 'yes', target: 'report' },
      { source: 'report', target: 'plan' },
      { source: 'plan', target: 'fix' },
      { source: 'fix', target: 'review', kind: 'back', maxTraversals: 8 },
      { source: 'has-issues', sourcePort: 'no', target: 'test' },
      { source: 'test', target: 'summary' },
      { source: 'summary', target: 'output' },
    ])
    const { outcome } = await run(value, {
      args: { target: '/repo/demo' },
      agent: async params => {
        const label = params.opts?.label ?? ''
        calls.push(label)
        switch (label) {
          case 'Review 代码':
            reviewContextSizes.push(params.conversation?.messages.length ?? 0)
            reviewRuns++
            return {
              status: 'completed',
              output: {
                hasIssues: reviewRuns < 3,
                issues: reviewRuns < 3 ? [{ id: `bug-${reviewRuns}` }] : [],
                summary: reviewRuns < 3 ? `第 ${reviewRuns} 轮发现问题` : 'Review 通过',
              },
            }
          case '生成问题报告':
            return { status: 'completed', output: { report: 'bug-1 报告' } }
          case '制定修复 Plan':
            return { status: 'completed', output: { plan: '修复 bug-1' } }
          case '修复代码':
            return { status: 'completed', output: { summary: 'bug-1 已修复' } }
          case '整体测试':
            return { status: 'completed', output: { passed: true, summary: '测试通过' } }
          case '总结结果':
            return { status: 'completed', output: { summary: '流程完成' } }
          default:
            throw new Error(`Unexpected Agent node: ${label}`)
        }
      },
    })

    expect(outcome.status).toBe('completed')
    expect(outcome.result).toEqual({ summary: '流程完成' })
    expect(outcome.agentCount).toBe(6)
    expect(calls).toEqual([
      'Review 代码',
      '生成问题报告',
      '制定修复 Plan',
      '修复代码',
      'Review 代码',
      '生成问题报告',
      '制定修复 Plan',
      '修复代码',
      'Review 代码',
      '整体测试',
      '总结结果',
    ])
    expect(reviewContextSizes).toEqual([0, 1, 2])
  })

  test('executes explicit parallel branches and waits at join', async () => {
    const value = definition([
      { id: 'split', type: 'parallel', title: '并行分析', branches: [{ port: 'left', label: '左侧' }, { port: 'right', label: '右侧' }] },
      { id: 'left', type: 'agent', title: '左侧分析', prompt: 'left', outputSchema: { type: 'string' } },
      { id: 'right', type: 'agent', title: '右侧分析', prompt: 'right', outputSchema: { type: 'string' } },
      { id: 'join', type: 'join', title: '汇合分析', parallelId: 'split' },
      {
        id: 'collect', type: 'code', title: '整理分析', language: 'javascript',
        input: [
          { target: ['left'], source: { kind: 'node-output', nodeId: 'left' } },
          { target: ['right'], source: { kind: 'node-output', nodeId: 'right' } },
        ], outputSchema: OBJECT, script: 'return input',
      },
    ], [
      { source: 'input', target: 'split' },
      { source: 'split', sourcePort: 'left', target: 'left' },
      { source: 'split', sourcePort: 'right', target: 'right' },
      { source: 'left', target: 'join' },
      { source: 'right', target: 'join' },
      { source: 'join', target: 'collect' },
      { source: 'collect', target: 'output' },
    ])
    const { outcome } = await run(value, {
      agent: async params => ({ status: 'completed', output: params.prompt.startsWith('left') ? 'left' : 'right' }),
    })
    expect(outcome.result).toEqual({ left: 'left', right: 'right' })
    expect(outcome.agentCount).toBe(2)
  })

  test('returns one declared array item for each foreach iteration', async () => {
    const value = definition([
      {
        id: 'each', type: 'foreach', title: '逐项整理',
        items: { kind: 'workflow-input', path: ['items'] },
        body: {
          entry: 'normalize',
          nodes: [{
            id: 'normalize', type: 'code', title: '整理当前项', language: 'javascript',
            input: [{ target: ['value'], source: { kind: 'iteration-item' } }],
            inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
            outputSchema: { type: 'string' },
            script: 'return input.value.trim().toUpperCase()',
          }],
          edges: [{ source: 'normalize', target: '$complete' }],
        },
        output: [{ target: [], source: { kind: 'node-output', nodeId: 'normalize' } }],
        outputSchema: { type: 'array', items: { type: 'string' } },
      },
    ], [{ source: 'input', target: 'each' }, { source: 'each', target: 'output' }])

    const { outcome } = await run(value, { args: { items: [' alpha ', 'beta'] } })

    expect(outcome.status).toBe('completed')
    expect(outcome.result).toEqual(['ALPHA', 'BETA'])
  })

  test('collects one child Workflow result per foreach item', async () => {
    const value = definition([
      {
        id: 'channels', type: 'foreach', title: '遍历渠道',
        items: { kind: 'workflow-input', path: ['channels'] },
        body: {
          entry: 'format',
          nodes: [{
            id: 'format', type: 'workflow', title: '格式化渠道消息',
            workflowId: 'wfd_0123456789abcdef', revision: 1,
            input: [
              { target: ['text'], source: { kind: 'workflow-input', path: ['text'] } },
              { target: ['channel'], source: { kind: 'iteration-item' } },
            ],
            inputSchema: {
              type: 'object', required: ['text', 'channel'],
              properties: { text: { type: 'string' }, channel: { type: 'string' } },
            },
            outputSchema: {
              type: 'object', required: ['message'], properties: { message: { type: 'string' } },
            },
          }],
          edges: [{ source: 'format', target: '$complete' }],
        },
        output: [{ target: [], source: { kind: 'node-output', nodeId: 'format' } }],
        outputSchema: {
          type: 'array',
          items: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        },
      },
    ], [{ source: 'input', target: 'channels' }, { source: 'channels', target: 'output' }])
    const calls: Array<{ channel: string; parentInstanceId: string }> = []

    const { outcome } = await run(value, {
      args: { text: '发布新版本', channels: ['研发群', '测试群'] },
      nested: async (reference, args, parentInstanceId) => {
        expect(reference).toEqual({ workflowId: 'wfd_0123456789abcdef', revision: 1 })
        const input = args as { text: string; channel: string }
        calls.push({ channel: input.channel, parentInstanceId })
        return { message: `${input.channel}：${input.text}` }
      },
    })

    expect(outcome.status).toBe('completed')
    expect(outcome.result).toEqual([
      { message: '研发群：发布新版本' },
      { message: '测试群：发布新版本' },
    ])
    expect(calls.map((entry) => entry.channel)).toEqual(['研发群', '测试群'])
    expect(new Set(calls.map((entry) => entry.parentInstanceId)).size).toBe(2)
  })

  test('stops immediately when an Agent reports blocked', async () => {
    const value = definition([
      { id: 'review', type: 'agent', title: 'Review 代码', prompt: 'review', outputSchema: OBJECT },
    ], [{ source: 'input', target: 'review' }, { source: 'review', target: 'output' }])
    const { outcome, events } = await run(value, {
      agent: async () => ({ status: 'blocked', reason: '没有可审查的代码' }),
    })
    expect(outcome.status).toBe('blocked')
    expect(outcome.error).toContain('没有可审查的代码')
    expect(events).toContainEqual(expect.objectContaining({ type: 'workflow_node', nodeId: 'review', state: 'blocked' }))
    expect(events.some(event => event.type === 'workflow_node' && event.nodeId === 'output')).toBe(false)
  })

  test('fails when a back edge exceeds its declared limit', async () => {
    const value = definition([
      { id: 'work', type: 'code', title: '重复处理', language: 'javascript', script: 'return {}', outputSchema: OBJECT },
      {
        id: 'check', type: 'condition', title: '是否继续？',
        branches: [{ port: 'yes', label: '是', when: { left: { kind: 'literal', value: true }, operator: 'equals', right: { kind: 'literal', value: true } } }],
        default: { port: 'no', label: '否' },
      },
    ], [
      { source: 'input', target: 'work' },
      { source: 'work', target: 'check' },
      { source: 'check', sourcePort: 'yes', target: 'work', kind: 'back', maxTraversals: 2 },
      { source: 'check', sourcePort: 'no', target: 'output' },
    ])
    const { outcome } = await run(value)
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('reached its limit (2)')
  })

  test('cancels the active Agent when the owning session aborts', async () => {
    const controller = new AbortController()
    const value = definition([
      { id: 'work', type: 'agent', title: '等待任务', prompt: 'wait', outputSchema: OBJECT },
    ], [{ source: 'input', target: 'work' }, { source: 'work', target: 'output' }])
    const running = run(value, {
      controller,
      agent: params => new Promise((_resolve, reject) => {
        params.abortController.signal.addEventListener('abort', () => reject(params.abortController.signal.reason), { once: true })
      }),
    })
    setTimeout(() => controller.abort(new Error('user stopped')), 5)
    const { outcome, events } = await running
    expect(outcome.status).toBe('cancelled')
    expect(events).toContainEqual(expect.objectContaining({ type: 'workflow_node', nodeId: 'work', state: 'cancelled' }))
  })

  test('rejects unsafe JavaScript APIs', async () => {
    const value = definition([
      { id: 'unsafe', type: 'code', title: '不安全处理', language: 'javascript', script: 'return Date.now()', outputSchema: {} },
    ], [{ source: 'input', target: 'unsafe' }, { source: 'unsafe', target: 'output' }])
    const { outcome } = await run(value)
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('Date')
  })
})
