import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { TraceList } from '../src/components/trace/TraceList'
import { TraceSession as SessionView } from '../src/components/trace/TraceSession'
import { TraceRows } from '../src/components/trace/TraceList'
import { TraceTree } from '../src/components/trace/TraceTree'
import { TraceDetail } from '../src/components/trace/TraceDetail'
import { TraceSplitLayout } from '../src/components/trace/TraceSplitLayout'
import { resetTraceSectionState } from '../src/components/trace/detail/Section'
import { buildTraceViewModel } from '../src/lib/trace/viewModel'
import type { TraceSession } from '../src/types/trace'

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
beforeEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { getAttribute: () => 'light' } } })
  resetTraceSectionState()
})
afterEach(() => {
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
})

const trace: TraceSession = {
  sessionId: 'trace-session', session: { id: 'trace-session', title: '排查模型重试', projectPath: '/fixture', workDir: null },
  summary: { apiCalls: 1, failedCalls: 1, totalDurationMs: 1234, totalInputTokens: 12, totalOutputTokens: 24, models: [{ model: 'fixture-model', calls: 1 }], updatedAt: '2026-09-01T10:00:03Z' },
  calls: [{ id: 'call', sessionId: 'trace-session', source: 'anthropic', status: 'error', model: 'fixture-model', startedAt: '2026-09-01T10:00:01Z', completedAt: '2026-09-01T10:00:02Z',
    request: { method: 'POST', url: 'https://example.test/messages', headers: {}, body: { contentType: 'json', bytes: 40, sha256: 'one', preview: '{"messages":[{"role":"user","content":"检查配置"}]}', truncated: false } },
    response: { status: 200, headers: {}, body: { contentType: 'json', bytes: 90, sha256: 'two', preview: '{"content":[{"type":"text","text":"收到的部分响应"}],"stop_reason":"end_turn"}', truncated: false } },
    error: { name: 'AbortError', message: 'The request was aborted' },
  }],
}
const messages = [
  { id: 'user', type: 'user' as const, content: '检查配置', timestamp: '2026-09-01T10:00:00Z' },
  { id: 'assistant', type: 'tool_use' as const, content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/fixture/settings.json' } }], timestamp: '2026-09-01T10:00:02Z' },
  { id: 'result', type: 'tool_result' as const, content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'configuration loaded' }], timestamp: '2026-09-01T10:00:03Z' },
]

describe('moss Trace composition', () => {
  test('App collection follows installation, without another capture switch', () => {
    const markup = renderToStaticMarkup(<TraceList onOpen={() => {}} />)
    expect(markup).toContain('启用 Trace App 后自动记录')
    expect(markup).not.toContain('type="checkbox"')
  })

  test('session details keep a return path to the list', () => {
    const markup = renderToStaticMarkup(<SessionView sessionId="trace-session" onBack={() => {}} />)
    expect(markup).toContain('trace-header')
    expect(markup).toContain('aria-label="返回列表"')
  })

  test('renders cc-haha list summaries and a separately named delete action', () => {
    const markup = renderToStaticMarkup(<TraceRows traces={[{ sessionId: trace.sessionId, session: trace.session!, summary: trace.summary, fileSize: 100, fileUpdatedAt: '2026-09-01T10:00:03Z' }]}
      total={1} loadingMore={false} deletingSessionId={null} onOpen={() => {}} onDelete={() => {}} onLoadMore={() => {}} />)
    expect(markup).toContain('role="listitem"')
    expect(markup).toContain('排查模型重试')
    expect(markup).toContain('fixture-model')
    expect(markup).toContain('aria-label="删除 Trace"')
    expect(markup).not.toContain('trace.list.')
  })

  test('preserves turn grouping, search, model/tool/error filters and paired tools', () => {
    const model = buildTraceViewModel(trace, messages)
    const markup = renderToStaticMarkup(<TraceTree viewModel={model} selectedId={model.rootId} onSelect={() => {}} />)
    expect(markup).toContain('role="tree"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('fixture-model')
    expect(markup).toContain('Read')
    expect(markup).toContain('检查配置')
    expect(markup).not.toContain('trace.filter.')
    expect(model.spans.filter((span) => span.kind === 'tool')).toHaveLength(1)
    expect(model.spans.find((span) => span.kind === 'tool')?.status).toBe('ok')
  })

  test('keeps partial response text visible beside an aborted-call diagnosis', () => {
    const model = buildTraceViewModel(trace, messages)
    const span = model.spans.find((item) => item.kind === 'llm')!
    const markup = renderToStaticMarkup(<TraceDetail span={span} viewModel={model} sessionId={trace.sessionId} onSelect={() => {}} />)
    expect(markup).toContain('trace-call-aborted-badge')
    expect(markup).toContain('收到的部分响应')
    expect(markup).toContain('AbortError')
    expect(markup).toContain('原始数据')
    expect(markup).toContain('消息')
  })

  test('keeps the protocol finish reason visible when the response preview is truncated', () => {
    const render = (finishReason: unknown) => {
      const partial: TraceSession = { ...trace, calls: [{ ...trace.calls[0], status: 'ok', error: undefined,
        metadata: { protocolTrace: { termination: { finishReason } } },
        response: { ...trace.calls[0].response!, body: { ...trace.calls[0].response!.body, preview: '{"content":[', truncated: true } },
      }] }
      const model = buildTraceViewModel(partial, messages)
      return renderToStaticMarkup(<TraceDetail span={model.spans.find((item) => item.kind === 'llm')!} viewModel={model} sessionId={trace.sessionId} onSelect={() => {}} />)
    }
    expect(render('max_tokens')).toContain('max_tokens')
    expect(render({ reason: 'max_tokens' })).not.toContain('max_tokens')
  })

  test('makes the split divider operable from the keyboard', () => {
    const markup = renderToStaticMarkup(<TraceSplitLayout tree={<div>tree</div>} detail={<div>detail</div>} />)
    expect(markup).toContain('role="separator"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('aria-valuenow="400"')
  })

  test('every migrated Trace component is reachable from the feature entry', () => {
    const root = resolve(import.meta.dir, '../src')
    const feature = resolve(root, 'components/trace')
    const reached = new Set<string>()
    const visit = (path: string) => {
      if (reached.has(path)) return
      reached.add(path)
      const content = readFileSync(path, 'utf8')
      for (const match of content.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
        const base = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier)
        for (const suffix of ['.tsx', '.ts']) {
          const next = base + suffix
          if (!next.startsWith(feature) && !next.startsWith(resolve(root, 'lib/trace'))) continue
          try { readFileSync(next); visit(next); break } catch { /* type declarations and external surfaces */ }
        }
      }
    }
    visit(resolve(root, 'App.tsx'))
    const components = readdirSync(feature, { recursive: true }).filter((path) => String(path).endsWith('.tsx')).map((path) => resolve(feature, String(path)))
    expect(components.filter((path) => !reached.has(path))).toEqual([])
  })
})
