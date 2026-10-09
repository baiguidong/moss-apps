import { tracesApi, type TraceSessionRevision, type TraceSessionSnapshot, type TraceTarget } from './api'

let nextReaderId = 0

export function traceRevisionKey(revision: Pick<TraceSessionRevision, 'revision' | 'revisionToken'>): string {
  return revision.revisionToken ? `token:${revision.revisionToken}` : `legacy:${revision.revision}`
}

/** cc-haha revision polling with the baseline read before its snapshot.
 * A write between the two reads will be revisited on the next poll, never skipped.
 */
export function createTraceSessionReader(target: TraceTarget, sessionId: string) {
  const readerId = ++nextReaderId
  let snapshotRevision = 0
  let currentRevision: number | undefined
  let currentToken: string | undefined
  let signature: string | null = null
  return async function read(force = false): Promise<{ snapshot: TraceSessionSnapshot | null; revisionKey?: string }> {
    let revision: TraceSessionRevision | undefined
    try {
      revision = await tracesApi.getRevision(target, sessionId, currentRevision, currentToken)
      if (!force && signature !== null && !revision.changed) return { snapshot: null, revisionKey: traceRevisionKey(revision) }
    } catch {
      // A server without the revision endpoint can still serve full snapshots.
      // Retry the endpoint next time, so one transient failure does not disable it.
    }
    const snapshot = await tracesApi.get(target, sessionId)
    if (!snapshot?.sessionId || !snapshot.summary || !Array.isArray(snapshot.calls)) throw new Error('Trace 快照为空或格式无效。')
    const nextSignature = traceSnapshotSignature(snapshot)
    if (revision) {
      currentRevision = revision.revision
      currentToken = revision.revisionToken
    }
    const changed = force || signature !== nextSignature
    if (changed) snapshotRevision += 1
    signature = nextSignature
    return { snapshot: changed ? snapshot : null, revisionKey: revision ? traceRevisionKey(revision) : `snapshot:${readerId}:${snapshotRevision}` }
  }
}

function traceSnapshotSignature(trace: TraceSessionSnapshot): string {
  return JSON.stringify({
    summary: trace.summary,
    // Old servers may omit the message signature; transcript-only updates still matter.
    messages: trace.messageSignature ?? trace.messages ?? null,
    calls: trace.calls.map((call) => ({
      id: call.id,
      status: call.status,
      completedAt: call.completedAt,
      durationMs: call.durationMs,
      usage: call.usage,
      responseStatus: call.response?.status,
      requestSha256: call.request.body.sha256,
      responseSha256: call.response?.body.sha256,
      error: call.error ? { name: call.error.name, message: call.error.message, code: call.error.code } : null,
    })),
    events: (trace.events ?? []).map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      phase: event.phase,
      severity: event.severity,
      callId: event.callId,
      message: event.message,
    })),
  })
}
