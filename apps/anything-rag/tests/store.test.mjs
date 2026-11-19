import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RagStore } from '../src/backend/store.mjs'

test('store persists spaces, documents, chunks and jobs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-store-'))
  const store = new RagStore(path.join(root, 'rag.sqlite'))
  t.after(() => store.close())
  const space = store.createSpace('space-test', '测试空间')
  const doc = store.upsertDocument({ id: 'doc-test', spaceId: space.id, sourcePath: 'a.md', filename: 'a.md', content: '内容', checksum: 'hash' })
  store.saveChunks(doc.id, [{ id: 'chunk-test', index: 0, content: '内容', metadata: { title: 'a.md' }, embedding: [1, 0] }])
  const listed = store.listDocuments({ spaceId: space.id })
  assert.equal(listed.total, 1)
  assert.equal(store.listChunks({ spaceId: space.id })[0].content, '内容')
  store.createJob('job-test', 'import', 1)
  store.updateJob('job-test', { status: 'done', completed: 1, message: '完成' })
  assert.equal(store.listJobs()[0].status, 'done')
})

test('recovers interrupted running jobs after an app restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-recovery-'))
  const file = path.join(root, 'rag.sqlite')
  const first = new RagStore(file)
  first.createJob('job-running', 'import', 2)
  first.close()
  const second = new RagStore(file)
  t.after(() => second.close())
  assert.equal(second.recoverInterruptedJobs(), 1)
  assert.equal(second.listJobs()[0].status, 'cancelled')
  assert.match(second.listJobs()[0].message, /上次退出/)
})
