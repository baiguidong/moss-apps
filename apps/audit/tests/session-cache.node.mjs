import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadSessionCache, saveSessionCache } from '../src/backend/session-cache.mjs'

test('restores unchanged session revisions across Backend restarts and ignores missing snapshots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-audit-session-cache-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'session-source')
  await fs.mkdir(directory)
  const snapshot = id => path.join(directory, `session-${createHash('sha256').update(id).digest('hex')}.json`)
  await fs.writeFile(snapshot('one'), JSON.stringify({ id: 'one', updatedAt: 123, history: [] }))
  await fs.writeFile(snapshot('two'), JSON.stringify({ id: 'two', updatedAt: 456, history: [] }))
  await saveSessionCache(root, new Map([['one', 'revision-1'], ['two', 'revision-2']]))

  const restored = await loadSessionCache(root)
  assert.equal(restored.revisions.get('one'), 'revision-1')
  assert.equal(restored.sessions.get('one').updatedAt, 123)
  assert.equal(restored.revisions.get('two'), 'revision-2')

  await fs.rm(snapshot('two'))
  const partial = await loadSessionCache(root)
  assert.equal(partial.revisions.get('one'), 'revision-1')
  assert.equal(partial.revisions.has('two'), false)
})
