import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { traceStore, trimTraceCallPreviews, withTraceScope } from './api/traceStore'
import type { MessageEntry } from '../types/trace-session'

export type TraceInput = { sessionId?: string; callId?: string; query?: string; limit?: number; offset?: number; sinceRevision?: number; sinceRevisionToken?: string }
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(value) || value === '.' || value === '..') throw new Error('无效的 Trace 标识。')
  return value
}
export function createTraceStore(dataDir: string) {
  const scope = path.join(dataDir, 'trace')
  async function summary(sessionId: string) {
    const snapshotFile = path.join(scope, 'sessions', `${identity(sessionId)}.json`)
    const summaryFile = path.join(scope, 'session-summaries', `${identity(sessionId)}.json`)
    const [snapshotStat, summaryStat] = await Promise.all([
      fs.stat(snapshotFile).catch(() => null), fs.stat(summaryFile).catch(() => null),
    ])
    if (summaryStat && (!snapshotStat || summaryStat.mtimeMs >= snapshotStat.mtimeMs)) {
      return JSON.parse(await fs.readFile(summaryFile, 'utf8')) as { session?: Awaited<ReturnType<typeof metadata>>['session'] }
    }
    const { session } = await metadata(sessionId)
    if (snapshotStat) {
      await fs.mkdir(path.dirname(summaryFile), { recursive: true })
      const temporary = `${summaryFile}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify({ session }), { mode: 0o600 })
        await fs.rename(temporary, summaryFile)
      } finally { await fs.rm(temporary, { force: true }) }
    }
    return { session }
  }
  async function metadata(id: string): Promise<{ session?: { id: string; title: string; projectPath: string; workDir: string | null }; messages: MessageEntry[] }> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(scope, 'sessions', `${identity(id)}.json`), 'utf8'))
      return { session: value.session, messages: Array.isArray(value.messages) ? value.messages : [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { messages: [] }
      throw new Error('会话信息无法读取，请刷新重试。')
    }
  }
  return {
    scope,
    async request(method: string, input: TraceInput = {}) {
      return withTraceScope(scope, async () => {
        if (method === 'traces.list') {
          const query = String(input.query || '').trim().toLowerCase()
          const metadataById = new Map<string, Awaited<ReturnType<typeof summary>>>()
          let sessionIds: string[] | undefined
          if (query) {
            const { files } = await traceStore.listSessionTraceFiles()
            sessionIds = []
            for (const file of files) {
              const meta = await summary(file.sessionId)
              metadataById.set(file.sessionId, meta)
              if ([file.sessionId, meta.session?.title, meta.session?.projectPath].some(value => value?.toLowerCase().includes(query))) sessionIds.push(file.sessionId)
            }
          }
          const result = await traceStore.listSessionTraces({ limit: input.limit ?? 50, offset: input.offset ?? 0, sessionIds })
          for (const item of result.traces) if (!metadataById.has(item.sessionId)) metadataById.set(item.sessionId, await summary(item.sessionId))
          return { ...result, traces: result.traces.map(item => ({ ...item, session: metadataById.get(item.sessionId)?.session })) }
        }
        const id = identity(input.sessionId)
        if (method === 'traces.get') {
          const [trace, meta] = await Promise.all([traceStore.getSessionTrace(id), metadata(id)])
          return { ...trace, ...meta, calls: trace.calls.map(call => trimTraceCallPreviews(call)),
            messageSignature: createHash('sha256').update(JSON.stringify(meta.messages)).digest('hex') }
        }
        if (method === 'traces.call') {
          const call = await traceStore.getSessionTraceCall(id, identity(input.callId))
          if (!call) throw new Error('找不到该模型调用。')
          return call
        }
        if (method === 'traces.revision') {
          const revision = await traceStore.getSessionTraceRevision(id)
          const stat = await fs.stat(path.join(scope, 'sessions', `${id}.json`)).catch(() => null)
          const revisionToken = `${revision.revisionToken}:${stat?.mtimeMs || 0}:${stat?.size || 0}`
          return { ...revision, revisionToken, changed: revisionToken !== input.sinceRevisionToken }
        }
        if (method === 'traces.delete') {
          const result = await traceStore.deleteSessionTrace(id)
          await fs.rm(path.join(scope, 'sessions', `${id}.json`), { force: true })
          await fs.rm(path.join(scope, 'session-summaries', `${id}.json`), { force: true })
          return result
        }
        throw new Error('不支持的 Trace 操作。')
      })
    },
  }
}
