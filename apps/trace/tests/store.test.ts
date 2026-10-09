import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTraceStore } from '../src/backend/store'
import { closeTraceStore } from '../src/backend/api/traceStore'
import { createResultTransport } from '../src/backend/backend'
import { call, fixture } from './fixture'

test('App indexes Core files incrementally, rebuilds the index, searches metadata and deletes its records', async () => {
  const f = await fixture()
  try {
    const store = createTraceStore(f.directory)
    const query = (method: string, input: any = {}) => store.request(method, input) as Promise<any>
    await f.append(call()); await f.metadata()
    expect((await query('traces.list')).traces[0].session.title).toBe('排查配置')
    expect((await query('traces.list', { query: 'project' })).total).toBe(1)
    expect((await query('traces.list', { query: 'missing' })).total).toBe(0)
    expect((await query('traces.list', { offset: 1 })).traces).toHaveLength(0)
    const before = await query('traces.revision', { sessionId: 'session-1' })
    await f.append(call({ status: 'ok', completedAt: '2026-09-30T10:00:03Z', durationMs: 2000, usage: { inputTokens: 12, outputTokens: 4 } }))
    const snapshot = await query('traces.get', { sessionId: 'session-1' })
    expect(snapshot.calls).toHaveLength(1); expect(snapshot.calls[0].status).toBe('ok')
    expect(snapshot.summary.totalInputTokens).toBe(12); expect(snapshot.messages[0].content).toBe('检查配置')
    const after = await query('traces.revision', { sessionId: 'session-1', sinceRevisionToken: before.revisionToken })
    expect(after.changed).toBe(true)
    expect((await query('traces.revision', { sessionId: 'session-1', sinceRevisionToken: after.revisionToken })).changed).toBe(false)
    await f.metadata('修改会话标题')
    expect((await query('traces.revision', { sessionId: 'session-1', sinceRevisionToken: after.revisionToken })).changed).toBe(true)
    expect((await query('traces.call', { sessionId: 'session-1', callId: 'call-1' })).request.semantic.request.system).toBe('系统提示词末尾标记')
    closeTraceStore(); await fs.rm(path.join(f.scope, 'db'), { recursive: true })
    expect((await query('traces.get', { sessionId: 'session-1' })).summary.apiCalls).toBe(1)
    expect((await query('traces.delete', { sessionId: 'session-1' })).deleted).toBe(true)
    expect((await query('traces.list')).total).toBe(0)
    await expect(fs.stat(path.join(f.scope, 'sessions/session-1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(query('traces.get', { sessionId: '../outside' })).rejects.toThrow('标识')
  } finally { closeTraceStore(); await f.cleanup() }
})

test('incomplete JSONL tails and malformed lines do not hide valid records or block later appends', async () => {
  const f = await fixture()
  try {
    const store = createTraceStore(f.directory)
    const file = path.join(f.scope, 'traces/session-1.jsonl')
    await f.append(call())
    const terminal = JSON.stringify({ type: 'call', record: call({ status: 'error', error: { name: 'Error', message: 'network failed' } }) })
    await fs.appendFile(file, 'broken\n' + terminal.slice(0, 80))
    expect((await store.request('traces.get', { sessionId: 'session-1' }) as any).calls[0].status).toBe('pending')
    await fs.appendFile(file, terminal.slice(80) + '\n')
    expect((await store.request('traces.get', { sessionId: 'session-1' }) as any).calls[0].status).toBe('error')
  } finally { closeTraceStore(); await f.cleanup() }
})

test('large Unicode requests cross App IPC in bounded chunks without truncation', () => {
  const transport = createResultTransport()
  const value = { prompt: '中文🙂'.repeat(160_000) + '末尾' }
  const packed = transport.pack(value)
  expect('transfer' in packed).toBe(true)
  if (!packed.transfer) throw new Error('missing transfer')
  const transfer = packed.transfer
  const chunks: Buffer[] = []; let offset = 0
  while (offset < packed.transfer.size) {
    const part = transport.read({ id: transfer.id, offset })
    expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThan(1024 * 1024)
    chunks.push(Buffer.from(part.data, 'base64')); offset = part.nextOffset
  }
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(value)
  expect(() => transport.read({ id: transfer.id, offset: -1 })).toThrow()
  transport.release(transfer.id)
  expect(() => transport.read({ id: transfer.id, offset: 0 })).toThrow('expired')
  transport.close()
})
