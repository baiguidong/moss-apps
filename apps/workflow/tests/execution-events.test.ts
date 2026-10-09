import { test, expect } from 'bun:test'
import type { AppExecutionClient, AppExecutionSummary, ExecutionChangedEvent } from '@moss/app-sdk/execution'
import { ExecutionWatcher } from '@moss/app-sdk/execution'

const initial: AppExecutionSummary = { id: 'one', key: 'key', taskId: 'task', contextKey: 'node', contextRef: 'agent', status: 'running', sequence: 2, tokens: 0, toolCalls: 0, createdAt: 1, attempt: 1 }
const completed = { ...initial, status: 'completed' as const, sequence: 4, resultRef: 'result' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function setup(get: (id: string, signal?: AbortSignal) => Promise<AppExecutionSummary>, refreshMs = 5000) {
  let listener: ((data: ExecutionChangedEvent) => void) | undefined
  let subscriptions = 0, queries = 0
  const client = {
    on: (_name: string, handler: (data: ExecutionChangedEvent) => void) => { listener = handler; subscriptions++; return () => { listener = undefined; subscriptions-- } },
    request: async (_method: string, input: { executionId: string }, options?: { signal?: AbortSignal }) => { queries++; return get(input.executionId, options?.signal) },
  } as unknown as AppExecutionClient
  const observer = new ExecutionWatcher(client, refreshMs)
  return { observer, push: (execution: AppExecutionSummary) => listener?.({ taskId: execution.taskId, execution, event: { eventId: 'event', executionId: execution.id, type: execution.status, sequence: execution.sequence, timestamp: 1 } }),
    subscriptions: () => subscriptions, queries: () => queries }
}

test('one subscription routes concurrent executions, ignores duplicates/old states and cleans up', async () => {
  const second = { ...initial, id: 'two' }
  const f = setup(async id => id === 'one' ? initial : second)
  const seen: number[] = []
  try {
    const one = f.observer.wait(initial, new AbortController().signal, state => seen.push(state.sequence))
    const two = f.observer.wait(second, new AbortController().signal, () => {})
    expect(f.subscriptions()).toBe(1)
    await tick()
    f.push({ ...initial, sequence: 3, tokens: 5 })
    f.push({ ...initial, sequence: 3, tokens: 5 })
    f.push(initial)
    f.push({ ...completed, id: 'two' })
    expect((await two).id).toBe('two')
    f.push(completed)
    expect(await one).toEqual(completed)
    f.push({ ...completed, sequence: 5 })
    expect(seen).toEqual([3, 4])
    expect(f.queries()).toBe(2)
  } finally { f.observer.close() }
  expect(f.subscriptions()).toBe(0)
})

test('the initial query recovers completion delivered before start returned; completed receipts need no query', async () => {
  const f = setup(async () => completed)
  try {
    expect(await f.observer.wait(initial, new AbortController().signal, () => {})).toEqual(completed)
    expect(await f.observer.wait(completed, new AbortController().signal, () => {})).toEqual(completed)
    expect(f.queries()).toBe(1)
  } finally { f.observer.close() }
})

test('a stale in-flight query cannot overwrite pushed progress', async () => {
  let release!: (value: AppExecutionSummary) => void
  const f = setup(() => new Promise(resolve => { release = resolve }))
  const seen: number[] = []
  try {
    const waiting = f.observer.wait(initial, new AbortController().signal, state => seen.push(state.sequence))
    f.push({ ...initial, sequence: 3 })
    release(initial)
    await tick()
    f.push(completed)
    expect((await waiting).status).toBe('completed')
    expect(seen).toEqual([3, 4])
  } finally { f.observer.close() }
})

test('fallback query recovers a missed completion event', async () => {
  let current = initial
  const f = setup(async () => current, 25)
  try {
    const waiting = f.observer.wait(initial, new AbortController().signal, () => {})
    await tick(); current = completed
    expect(await waiting).toEqual(completed)
    expect(f.queries()).toBe(2)
  } finally { f.observer.close() }
})

test('cancel and shutdown reject waits and abort in-flight queries without cancelling Agent execution', async () => {
  for (const close of [false, true]) {
    let querySignal: AbortSignal | undefined
    const f = setup((_id, signal) => { querySignal = signal; return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })) }, 10)
    const controller = new AbortController()
    const waiting = f.observer.wait(initial, controller.signal, () => {}).catch(error => error)
    if (close) f.observer.close(); else controller.abort(new Error('stopped'))
    expect(await waiting).toBeInstanceOf(Error)
    expect(querySignal?.aborted).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(f.queries()).toBe(1)
    f.observer.close()
    expect(f.subscriptions()).toBe(0)
  }
})
