// File reads and writes share a lane so a revision always describes the bytes
// returned by the action. Indexing has its own queue; jobs.cancel stays immediate.
export function createActionLane() {
  let pending = Promise.resolve()
  const shutdown = new AbortController()
  return {
    run(fn, signal) {
      const combined = signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal
      const result = pending.then(() => { combined.throwIfAborted(); return fn(combined) })
      pending = result.catch(() => {})
      return result
    },
    async close() { shutdown.abort(); await pending },
  }
}

// Leave space for the SDK envelope (1 MiB). List callers can request the next page.
export function listResult(data, input = {}, maxBytes = 700 * 1024) {
  const page = []
  let bytes = 0
  for (const item of data) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1
    if (bytes + size > maxBytes) break
    page.push(item); bytes += size
  }
  return { data: page, truncated: page.length < data.length,
    nextOffset: page.length < data.length || data.length === (input.limit || 100) ? (input.offset || 0) + page.length : null }
}
