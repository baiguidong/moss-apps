import type { TraceSessionList } from '@/types/trace'
import { tracesApi, type TraceTarget } from './api'

const MAX_PAGE_SIZE = 200

/** One list request sequence per target/search scope. A refresh preserves the
 * visible window even when the service caps each page at 200 records. */
export function createTraceListReader(target: TraceTarget, query: string) {
  let active: Promise<TraceSessionList> | null = null
  return {
    get busy() { return active !== null },
    async waitForIdle() { await active?.catch(() => undefined) },
    read({ limit, offset = 0 }: { limit: number; offset?: number }): Promise<TraceSessionList | null> {
      if (active) return Promise.resolve(null)
      const pending = readWindow(target, query, limit, offset)
      active = pending
      return pending.finally(() => { if (active === pending) active = null })
    },
  }
}

async function readWindow(target: TraceTarget, query: string, limit: number, offset: number): Promise<TraceSessionList> {
  let response: TraceSessionList | undefined
  const traces: TraceSessionList['traces'] = []
  let readCount = 0
  while (readCount < limit) {
    const page = await tracesApi.list(target, { limit: Math.min(MAX_PAGE_SIZE, limit - readCount), offset: offset + readCount, query })
    response = page
    traces.push(...page.traces)
    readCount += page.traces.length
    if (page.traces.length === 0 || offset + readCount >= page.total) break
  }
  if (!response) throw new Error('Trace 列表分页参数无效。')
  const seen = new Set<string>()
  return { ...response, traces: traces.filter((trace) => {
    if (seen.has(trace.sessionId)) return false
    seen.add(trace.sessionId)
    return true
  }) }
}
