import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionOverview } from '../src/components/trace/detail/SessionOverview'
import { buildTraceViewModel, getToolDurationMs, getTraceErrorSpans, type TraceSpan } from '../src/lib/trace/viewModel'
import type { MessageEntry } from '../src/types/trace-session'
import type { TraceEventRecord, TraceSession } from '../src/types/trace'
import { call } from './fixture'

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
beforeEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { getAttribute: () => 'light' } } })
})
afterEach(() => {
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
})

const trace: TraceSession = {
  sessionId: 'session-1', session: null, calls: [], events: [],
  summary: { apiCalls: 0, failedCalls: 0, totalDurationMs: 0, totalInputTokens: 0,
    totalOutputTokens: 0, models: [], updatedAt: '2026-10-22T06:21:31.000Z' },
}
const time = (milliseconds: number) => new Date(Date.parse('2026-10-22T06:21:21.000Z') + milliseconds).toISOString()
const user: MessageEntry = { id: 'user', type: 'user', timestamp: time(0), timestampSource: 'explicit', content: '你好' }
const toolMessage = (identity: string, timestamp = time(0), timestampSource?: MessageEntry['timestampSource']): MessageEntry => ({
  id: `message-${identity}`, type: 'tool_use', timestamp, timestampSource,
  content: [{ type: 'tool_use', id: identity, name: 'Read', input: {} }],
})
const resultMessage = (identity: string, failed = false, timestamp = time(5000)): MessageEntry => ({
  id: `result-${identity}`, type: 'tool_result', timestamp, timestampSource: 'explicit',
  content: [{ type: 'tool_result', tool_use_id: identity, is_error: failed, content: failed ? 'invalid pages' : 'loaded' }],
})
const timing = (identity: string, started: number, ended?: number, failed = false): TraceEventRecord => ({
  id: `${identity}-${ended === undefined ? 'start' : 'end'}`, sessionId: trace.sessionId,
  timestamp: time(ended ?? started), phase: ended === undefined ? 'tool_execution_started' : 'tool_execution_completed',
  severity: failed ? 'error' : 'info',
  metadata: { toolUseId: identity, startedAt: time(started), ...(ended === undefined ? {} : { status: failed ? 'error' : 'ok', durationMs: ended - started }) },
})
const stat = (markup: string, label: string) => markup.match(new RegExp(`>${label}</div><div[^>]*>([^<]+)</div>`))?.[1]

describe('Trace error and timing statistics', () => {
  test('counts two failed reads once each, not their result and aggregate nodes', () => {
    const messages = [user, toolMessage('read-a'), resultMessage('read-a', true),
      toolMessage('read-b'), resultMessage('read-b', true), toolMessage('retry-a'), resultMessage('retry-a'),
      toolMessage('retry-b'), resultMessage('retry-b')]
    const view = buildTraceViewModel(trace, messages)
    expect(view.spans.filter(span => span.status === 'error')).toHaveLength(6)
    expect(getTraceErrorSpans(view.spans).map(span => span.toolUseId)).toEqual(['read-a', 'read-b'])
    expect(view.diagnosis.errorCount).toBe(2)
    for (const identity of [view.rootId, 'turn:0']) {
      const markup = renderToStaticMarkup(<SessionOverview span={view.spansById.get(identity)!} viewModel={view} onSelect={() => {}} />)
      expect(stat(markup, '错误')).toBe('2')
      expect(stat(markup, '工具调用')).toBe('4')
      expect(stat(markup, '工具耗时')).toBe('--')
    }
  })

  test('counts a failed model call and its failure event once while keeping independent errors', () => {
    const failed = call({ status: 'error', error: { name: 'AbortError', message: 'aborted' }, completedAt: time(1000), startedAt: time(0) })
    const event: TraceEventRecord = { id: 'failed-event', sessionId: trace.sessionId, timestamp: time(1000),
      phase: 'api_call_aborted', severity: 'error', callId: failed.id }
    const independent = { ...event, id: 'independent-event', phase: 'capture_failed' }
    const view = buildTraceViewModel({ ...trace, calls: [failed], events: [event, independent] }, [user])
    expect(getTraceErrorSpans(view.spans).map(span => span.kind)).toEqual(['llm', 'event'])
    expect(view.diagnosis.errorCount).toBe(2)
  })

  test('does not lose orphan failed results or collapse failures without tool identities', () => {
    const orphan = resultMessage('missing-tool', true)
    const other = { ...orphan, id: 'without-id', content: [{ type: 'tool_result', is_error: true, content: 'failure' }] }
    const view = buildTraceViewModel(trace, [user, orphan, other])
    expect(getTraceErrorSpans(view.spans)).toHaveLength(2)
    expect(view.diagnosis.errorCount).toBe(2)
  })

  test('unknown or inherited historical starts never become five seconds of model waiting', () => {
    for (const source of [undefined, 'inherited'] as const) {
      const view = buildTraceViewModel(trace, [user, toolMessage('read', time(0), source), resultMessage('read')])
      expect(view.spansById.get('tool:read')).toMatchObject({ timingSource: 'unknown', status: 'ok', completedAt: time(5000) })
      expect(view.spansById.get('tool:read')?.durationMs).toBeUndefined()
      expect(getToolDurationMs(view.spans)).toBeUndefined()
    }
  })

  test('execution events override inherited timestamps and delayed tool-result delivery', () => {
    const view = buildTraceViewModel({ ...trace, events: [timing('read', 4900), timing('read', 4900, 4912, true)] },
      [user, toolMessage('read'), resultMessage('read', true, time(5500))])
    const tool = view.spansById.get('tool:read')!
    expect(tool).toMatchObject({ timestamp: time(4900), completedAt: time(4912), durationMs: 12, timingSource: 'execution', status: 'error' })
    expect(view.spansById.get('event:read-end')).toMatchObject({ parentId: tool.id, isLifecycleNoise: true })
    expect(getToolDurationMs(view.spans)).toBe(12)
    expect(view.diagnosis.errorCount).toBe(1)
    const markup = renderToStaticMarkup(<SessionOverview span={view.spansById.get(view.rootId)!} viewModel={view} onSelect={() => {}} />)
    expect(stat(markup, '工具耗时')).toBe('12ms')
  })

  test('unions parallel tool intervals instead of summing overlapping work', () => {
    const view = buildTraceViewModel({ ...trace, events: [timing('read-a', 4900), timing('read-a', 4900, 5000),
      timing('read-b', 4950), timing('read-b', 4950, 5100)] },
      [user, toolMessage('read-a'), toolMessage('read-b'), resultMessage('read-a'), resultMessage('read-b')])
    expect(getToolDurationMs(view.spans)).toBe(200)
    const markup = renderToStaticMarkup(<SessionOverview span={view.spansById.get(view.rootId)!} viewModel={view} onSelect={() => {}} />)
    expect(stat(markup, '工具耗时')).toBe('200ms')
  })

  test('handles sequential, nested, zero and partially unknown intervals without inventing totals', () => {
    const interval = (identity: string, start: number, durationMs?: number): TraceSpan => ({
      id: identity, parentId: null, childIds: [], kind: 'tool', status: 'ok', title: identity,
      subtitle: '', timestamp: time(start), durationMs, raw: {},
    })
    expect(getToolDurationMs([interval('a', 0, 100), interval('b', 200, 50)])).toBe(150)
    expect(getToolDurationMs([interval('parent', 0, 200), interval('child', 50, 50)])).toBe(200)
    expect(getToolDurationMs([interval('instant', 0, 0)])).toBe(0)
    expect(getToolDurationMs([interval('known', 0, 20), interval('unknown', 30)])).toBeUndefined()
  })

  test('uses actual started events for pending tools and tolerates reversed event arrival', () => {
    const messages = [user, toolMessage('read')]
    const pending = buildTraceViewModel({ ...trace, events: [timing('read', 4900)] }, messages, { now: time(5100) })
    expect(pending.spansById.get('tool:read')).toMatchObject({ status: 'pending', durationMs: 200, timestamp: time(4900) })
    expect(pending.spansById.get('tool:read')?.completedAt).toBeUndefined()
    const completed = buildTraceViewModel({ ...trace, events: [timing('read', 4900, 5000), timing('read', 4900)] }, messages)
    expect(completed.spansById.get('tool:read')).toMatchObject({ status: 'ok', durationMs: 100, completedAt: time(5000) })
  })
})
