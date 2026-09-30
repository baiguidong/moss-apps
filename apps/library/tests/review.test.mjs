import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLibraryService } from '../src/backend/store.mjs'
import { createActionLane, listResult } from '../src/backend/actions.mjs'
const parserPath = new URL('../src/backend/library_parser.py', import.meta.url).pathname
const parse = async file => ({ parser: 'test', blocks: [{ text: await fs.readFile(file, 'utf8') }] })
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-library-review-'))
  const service = createLibraryService({ libraryRoot: path.join(directory, 'data'), parserPath, parseDocument: parse, ...options })
  t.after(async () => { service.close(); await service.waitForIdle(); await fs.rm(directory, { recursive: true, force: true }) })
  return { directory, service, collectionId: service.listCollections()[0].id }
}
function blocker() {
  let entered
  const started = new Promise(resolve => { entered = resolve })
  return { started, async parse(file, { signal }) {
    const text = await fs.readFile(file, 'utf8')
    if (text.includes('blocked')) {
      entered()
      await new Promise((_, reject) => {
        const cancel = () => reject(Object.assign(new Error('cancelled'), { code: 'PARSER_CANCELLED' }))
        if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true })
      })
    }
    return { parser: 'test', blocks: [{ text }] }
  } }
}
test('graceful restart resumes the latest edited content after a previous successful index', async t => {
  const blocked = blocker()
  const { directory, service: s, collectionId } = await fixture(t, { parseDocument: blocked.parse })
  const doc = (await s.createDocument({ collectionId, title: 'Recovery', content: 'original evidence' })).resource
  await s.waitForIdle()
  await s.updateDocument({ resourceId: doc.id, revision: doc.revision, content: 'blocked replacement evidence' })
  await blocked.started
  s.close(); await s.waitForIdle()
  const resumed = createLibraryService({ libraryRoot: path.join(directory, 'data'), parserPath, parseDocument: parse })
  t.after(async () => { resumed.close(); await resumed.waitForIdle() })
  await resumed.waitForIdle()
  assert.equal(resumed.search({ query: 'replacement' })[0].resourceId, doc.id)
  assert.equal(resumed.search({ query: 'original' }).length, 0)
})
test('deletion cancels its own queued index without waiting for another source parser', async t => {
  const blocked = blocker()
  const { service: s, collectionId } = await fixture(t, { parseDocument: blocked.parse })
  await s.createDocument({ collectionId, title: 'Slow', content: 'blocked unrelated source' })
  await blocked.started
  const doc = (await s.createDocument({ collectionId, title: 'Delete me', content: 'queued evidence' })).resource
  await s.deleteDocument({ resourceId: doc.id, revision: doc.revision })
  assert.equal(s.listResources().some(r => r.id === doc.id), false)
  assert.equal(s.listJobs().some(j => j.status === 'running'), true)
})
test('updating a parsing document cancels old parsing and indexes only the new revision', async t => {
  const blocked = blocker()
  const { service: s, collectionId } = await fixture(t, { parseDocument: blocked.parse })
  const doc = (await s.createDocument({ collectionId, title: 'Update', content: 'blocked old version' })).resource
  await blocked.started
  const next = await s.updateDocument({ resourceId: doc.id, revision: doc.revision, content: 'replacement final version' })
  await s.waitForIdle()
  assert.equal(s.search({ query: 'replacement' })[0].revision, next.resource.revision)
  assert.equal(s.search({ query: 'blocked' }).length, 0)
})
test('file action lane returns matching content and revision during concurrent read and write', async t => {
  const { service: s, collectionId } = await fixture(t)
  const lane = createActionLane()
  const doc = (await s.createDocument({ collectionId, title: 'Atomic read', content: 'before' })).resource
  await s.waitForIdle()
  const [before, changed, after] = await Promise.all([
    lane.run(() => s.readDocument({ resourceId: doc.id })),
    lane.run(() => s.updateDocument({ resourceId: doc.id, revision: doc.revision, content: 'after' })),
    lane.run(() => s.readDocument({ resourceId: doc.id })),
  ])
  assert.equal(before.content, 'before'); assert.equal(before.revision, doc.revision)
  assert.equal(after.content, 'after'); assert.equal(after.revision, changed.resource.revision)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(lane.run(() => assert.fail('cancelled action ran'), controller.signal))
  await lane.close()
  await assert.rejects(lane.run(() => assert.fail('action ran after shutdown')))
})
test('exported revisions are immutable and refresh hashes actual managed bytes', async t => {
  const { service: s, collectionId } = await fixture(t)
  const doc = (await s.createDocument({ collectionId, title: 'Export', content: 'before' })).resource
  await s.waitForIdle()
  const original = await s.exportResource({ resourceId: doc.id, revision: doc.revision })
  await s.updateDocument({ resourceId: doc.id, revision: doc.revision, content: 'after' })
  await s.waitForIdle()
  const current = await s.exportResource({ resourceId: doc.id })
  assert.notEqual(original.path, current.path)
  assert.equal(await fs.readFile(original.path, 'utf8'), 'before')
  const managed = await s.openResource({ resourceId: doc.id })
  await fs.writeFile(managed.path, 'recovered external change')
  await assert.rejects(s.exportResource({ resourceId: doc.id }), /变化/)
  await assert.rejects(s.readDocument({ resourceId: doc.id }), /变化/)
  s.refreshSource({ sourceId: doc.sourceId }); await s.waitForIdle()
  assert.equal(s.search({ query: 'recovered' }).length, 1)
})
test('long Unicode titles and sanitized file names retain distinct documents', async t => {
  const { directory, service: s, collectionId } = await fixture(t)
  const title = '知识'.repeat(80)
  const doc = (await s.createDocument({ collectionId, title, content: 'unicode note' })).resource
  assert.equal(doc.title, title)
  const source = path.join(directory, 'originals'); await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'a:b.md'), 'first distinct')
  await fs.writeFile(path.join(source, 'a?b.md'), 'second distinct')
  const result = await s.importFiles({ collectionId, paths: [source, source] })
  assert.equal(result.written.length, 2); assert.deepEqual(result.failed, [])
  await s.waitForIdle()
  assert.equal(s.search({ query: 'distinct' }).length, 2)
  assert.notEqual(s.search({ query: 'first' })[0].resourceId, s.search({ query: 'second' })[0].resourceId)
})
test('large escaped text and list pages stay below the backend envelope budget', async t => {
  const { service: s, collectionId } = await fixture(t)
  await assert.rejects(s.createDocument({ collectionId, title: 'Escaped', content: '\u0000'.repeat(200000) }), /正文/)
  const response = listResult(Array.from({ length: 100 }, (_, id) => ({ id, content: 'x'.repeat(20000) })), { offset: 10 })
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 1024 * 1024)
  assert.equal(response.truncated, true)
  assert.equal(response.nextOffset, 10 + response.data.length)
})
test('canceling an import keeps committed sources consistent and skips later paths', async t => {
  const controller = new AbortController()
  let cancel = false
  const { directory, service: s, collectionId } = await fixture(t, { onChanged: event => {
    if (cancel && event.reason === 'job-created') controller.abort()
  } })
  const one = path.join(directory, 'one.md'), two = path.join(directory, 'two.md')
  await fs.writeFile(one, 'first persisted'); await fs.writeFile(two, 'second skipped')
  cancel = true
  await assert.rejects(s.importFiles({ collectionId, paths: [one, two] }, { signal: controller.signal }))
  await s.waitForIdle()
  assert.equal(s.listResources().length, 1)
  assert.equal(s.search({ query: 'persisted' }).length, 1)
  assert.equal(s.search({ query: 'skipped' }).length, 0)
})
test('stale indexed documents expose the content revision and current mutation revision separately', async t => {
  const { directory, service: s, collectionId } = await fixture(t, { parseDocument: async file => {
    const text = await fs.readFile(file, 'utf8')
    if (text.includes('FAIL')) throw new Error('parse failed')
    return { parser: 'test', blocks: [{ text }] }
  } })
  const original = path.join(directory, 'evidence.html'); await fs.writeFile(original, 'old evidence')
  await s.importFiles({ collectionId, paths: [original] }); await s.waitForIdle()
  const doc = s.listResources()[0]
  await fs.writeFile(original, 'FAIL new evidence')
  await s.importFiles({ collectionId, paths: [original] }); await s.waitForIdle()
  const read = await s.readDocument({ resourceId: doc.id })
  assert.equal(read.content, 'old evidence'); assert.equal(read.revision, doc.revision)
  assert.notEqual(read.currentRevision, read.revision)
  await s.deleteDocument({ resourceId: doc.id, revision: read.currentRevision })
  assert.equal(s.listResources().length, 0)
})
