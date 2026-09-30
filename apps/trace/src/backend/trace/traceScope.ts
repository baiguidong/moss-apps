import { AsyncLocalStorage } from 'node:async_hooks'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const traceScope = new AsyncLocalStorage<string>()

/** Scope is supplied by the host so concurrent users never share trace data. */
export function getTraceScope(): string {
  return traceScope.getStore()
    ?? (process.env.MOSS_CONFIG_DIR || join(homedir(), '.moss')).normalize('NFC')
}

export function withTraceScope<T>(scope: string, callback: () => T): T {
  return traceScope.run(resolve(scope), callback)
}
