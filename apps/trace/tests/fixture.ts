import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { TraceCallRecord } from '../src/types/trace'
export const call = (overrides: Partial<TraceCallRecord> = {}): TraceCallRecord => ({
  id: 'call-1', sessionId: 'session-1', source: 'anthropic', model: 'fixture-model', status: 'pending',
  startedAt: '2026-09-30T10:00:01Z', request: { method: 'POST', url: 'https://example.test/messages', headers: {},
    body: { contentType: 'json', bytes: 2, sha256: 'fixture', preview: '{}', truncated: false },
    semantic: { version: 1, request: { model: 'fixture-model', system: '系统提示词末尾标记', messages: [{ role: 'user', content: '检查配置' }] } } }, ...overrides,
})
export async function fixture() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'trace-reader-'))
  const scope = path.join(directory, 'trace')
  await fs.mkdir(path.join(scope, 'traces'), { recursive: true })
  await fs.mkdir(path.join(scope, 'sessions'))
  const append = (record: TraceCallRecord) => fs.appendFile(path.join(scope, 'traces', `${record.sessionId}.jsonl`), JSON.stringify({ schemaVersion: 1, type: 'call', record }) + '\n')
  const metadata = (title = '排查配置') => fs.writeFile(path.join(scope, 'sessions/session-1.json'), JSON.stringify({ schemaVersion: 1,
    session: { id: 'desktop-1', title, projectPath: '/fixture/project', workDir: '/fixture/project' },
    messages: [{ id: 'u1', type: 'user', content: '检查配置', timestamp: '2026-09-30T10:00:00Z' }] }))
  return { directory, scope, append, metadata, cleanup: () => fs.rm(directory, { recursive: true, force: true }) }
}
