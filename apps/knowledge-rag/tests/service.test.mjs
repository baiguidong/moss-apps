import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeService, clearStaleEngineLock, pageContent, relativeDocument } from '../src/backend/service.mjs'
import { decodeToolResult } from '../src/backend/mcp.mjs'

test('MCP structured failures propagate and successful JSON text is decoded', () => {
  assert.deepEqual(decodeToolResult({ content: [{ type: 'text', text: '{"status":"success","results":[]}' }] }), { status: 'success', results: [] })
  for (const data of [{ status: 'error', message: 'not found' }, { error: 'bad path' }]) assert.throws(() => decodeToolResult({ content: [{ type: 'text', text: JSON.stringify(data) }] }))
  assert.throws(() => decodeToolResult({ isError: true, content: [{ type: 'text', text: 'failed' }] }), /failed/)
})
test('reading pages cannot escape the corpus or lose page boundaries', () => {
  assert.throws(() => relativeDocument('/tmp/corpus', '../private'))
  assert.throws(() => relativeDocument('/tmp/corpus', '/etc/passwd'))
  assert.equal(relativeDocument('/tmp/corpus', '/tmp/corpus/a.md'), 'a.md')
  assert.deepEqual(pageContent('abcdef', 2, 3), { content: 'cde', offset: 2, nextOffset: 5, totalLength: 6 })
})
test('canonical storage paths accept Python sources through a directory alias', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-rag-alias-'))
  try {
    await fs.mkdir(path.join(root, 'actual'))
    await fs.symlink(path.join(root, 'actual'), path.join(root, 'alias'))
    const service = new KnowledgeService({ dataDir: path.join(root, 'alias'), resourcesDir: root })
    await service.prepareStorage()
    const source = path.join(await fs.realpath(root), 'actual/engine/documents/note.md')
    assert.equal(service.normalizeDocument({ source }).filepath, 'note.md')
    assert.throws(() => service.normalizeDocument({ source: path.join(root, 'outside.md') }))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('stale engine PID files from dead or unrelated processes are recoverable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-rag-lock-'))
  const lockDir = path.join(root, 'engine', 'data')
  const lockPath = path.join(lockDir, 'knowledge-rag.lock')
  try {
    await fs.mkdir(lockDir, { recursive: true })
    // The current Node test process is alive, but it is not the Python engine.
    await fs.writeFile(lockPath, `${process.pid}\n`)
    assert.equal(await clearStaleEngineLock(root), true)
    await assert.rejects(fs.access(lockPath))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('installation is reusable only with a complete matching dependency lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-rag-install-state-'))
  try {
    const service = new KnowledgeService({ dataDir: root, resourcesDir: root })
    await fs.writeFile(path.join(root, 'requirements.lock'), 'locked-v1')
    await fs.mkdir(path.join(service.venv, process.platform === 'win32' ? 'Scripts' : 'bin'), { recursive: true })
    await fs.writeFile(path.join(service.venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), '')
    const marker = path.join(service.venv, 'ready.json')
    await fs.writeFile(marker, JSON.stringify({ version: '4.11.0', requirementsSha256: service.requirementsHash() }))
    assert.equal(service.installed(), true)
    await fs.writeFile(path.join(root, 'requirements.lock'), 'locked-v2')
    assert.equal(service.installed(), false)
    await fs.writeFile(marker, '{partial')
    assert.equal(service.installed(), false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('environment diagnostics use the Moss managed Python capability', async () => {
  const calls = []
  const service = new KnowledgeService({
    dataDir: '/unused', resourcesDir: '/unused',
    getPython: async () => { calls.push('python.get'); return { available: true, path: '/moss/runtimes/python/bin/python3', version: '3.13.15' } },
  })
  const status = await service.overview()
  assert.deepEqual(status.runtime.python, { available: true, path: '/moss/runtimes/python/bin/python3', version: '3.13.15', source: 'moss-managed', error: null })
  assert.deepEqual(calls, ['python.get'])
  await service.overview()
  assert.deepEqual(calls, ['python.get'])
  await service.close()
})
test('environment diagnostics expose an unavailable managed runtime before preparation', async () => {
  const service = new KnowledgeService({
    dataDir: '/unused', resourcesDir: '/unused',
    getPython: async () => ({ available: false, path: null, version: null }),
  })
  const status = await service.overview()
  assert.equal(status.runtime.python.available, false)
  assert.equal(status.runtime.python.path, null)
  await service.close()
})
test('shutdown completes even when process close happened before cleanup', async () => {
  const service = new KnowledgeService({ dataDir: '/unused', resourcesDir: '/unused' })
  service.process = { pid: undefined, exitCode: null, signalCode: null, kill() { throw new Error('must not kill a failed spawn') } }
  service.processDone = Promise.resolve()
  await service.close()
  assert.equal(service.process, null)
})
test('import keeps originals, separates same-named sources, rejects links, and submits one reindex', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-rag-import-'))
  const service = new KnowledgeService({ dataDir: path.join(root,'data'), resourcesDir: root })
  const calls = []
  service.call = async name => { calls.push(name); return name === 'get_reindex_status' ? { reindex: { active: false } } : { status: 'started' } }
  try {
    await fs.mkdir(path.join(root,'one')); await fs.mkdir(path.join(root,'two'))
    const a = path.join(root,'one','note.md'), b = path.join(root,'two','note.md'), link = path.join(root,'link.md')
    await fs.writeFile(a,'first'); await fs.writeFile(b,'second'); await fs.symlink(a,link)
    const result = await service.importFiles({ paths: [a,b,link,root] })
    assert.equal(result.written.length,2); assert.equal(result.failed.length,2)
    assert.notEqual(result.written[0].filepath,result.written[1].filepath)
    assert.equal(await fs.readFile(a,'utf8'),'first')
    assert.equal(await fs.readFile(path.join(service.documentsDir,result.written[1].filepath),'utf8'),'second')
    await fs.writeFile(a,'changed')
    const repeat = await service.importFiles({ paths: [a] })
    assert.equal(repeat.written[0].filepath,result.written[0].filepath)
    assert.equal(await fs.readFile(path.join(service.documentsDir,result.written[0].filepath),'utf8'),'changed')
    assert.equal(calls.filter(name => name === 'reindex_documents').length,2)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(service.importFiles({ paths: [a] }, { signal: controller.signal }))
  } finally { await service.close(); await fs.rm(root,{recursive:true,force:true}) }
})
test('failed installation stays retryable and overlapping preparation is coalesced', async () => {
  const service = new KnowledgeService({ dataDir: '/unused', resourcesDir: '/unused' })
  let count = 0
  service.install = async () => { ++count; await new Promise(resolve => setTimeout(resolve,10)); throw new Error('download failed') }
  service.begin('install'); const pending = service.operation; service.begin('install')
  assert.equal(service.operation,pending); await pending; await Promise.resolve()
  assert.equal(count,1); assert.equal(service.state,'failed'); assert.match(service.error,/download failed/)
  service.begin('install'); await service.operation; assert.equal(count,2)
  await service.close()
})

test('editor reads the full UTF-8 source and detects stale edits before invoking the writer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-edit-'))
  const service = new KnowledgeService({ dataDir: root, resourcesDir: root })
  try {
    await service.prepareStorage()
    const content = '---\ntitle: Guide\n---\n' + '正文'.repeat(20000)
    const file = path.join(service.documentsDir, 'guide.md')
    await fs.writeFile(file, content)
    const draft = await service.source({ filepath: 'guide.md' })
    assert.equal(draft.content, content)
    assert.match(draft.revision, /^[a-f0-9]{64}$/)
    const calls = []
    service.call = async (name, args) => { calls.push([name, args]); return {} }
    await service.update({ filepath: 'guide.md', revision: draft.revision, content: 'new text' })
    assert.deepEqual(calls, [['update_document', { filepath: 'guide.md', content: 'new text' }]])
    await fs.writeFile(file, 'changed elsewhere')
    await assert.rejects(service.update({ filepath: 'guide.md', revision: draft.revision, content }), /文件已更改/)
    await assert.rejects(service.create({ filepath: 'guide.md', content }), /同名文件/)
    await assert.rejects(service.create({ filepath: '../outside.md', content }))
    await assert.rejects(service.source({ filepath: 'report.pdf' }))
    assert.equal(calls.length, 1)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('search controls reach the engine including zero weights, folder filters and full-text mode', async () => {
  const service = new KnowledgeService({ dataDir: '/unused', resourcesDir: '/unused' })
  let args
  service.call = async (name, input) => {
    assert.equal(name, 'search_knowledge')
    args = input
    return { filtered_by_score: 2, results: [{ source: 'general/test.md', content: 'match', score: 0.5, chunk_index: 1 }] }
  }
  const result = await service.search({ query: ' needle ', category: 'general', hybridAlpha: 0, minScore: 0.4, limit: 8, snippet: true, method: 'fts5', includeFolders: ['general'], excludeFolders: ['general/archive'] })
  assert.deepEqual(args, { query: 'needle', category: 'general', hybrid_alpha: 0, min_score: 0.4, max_results: 8, snippet_mode: true, search_method: 'fts5', include_folders: ['general'], exclude_folders: ['general/archive'] })
  assert.equal(result.items[0].filepath, 'general/test.md')
  assert.equal(result.filtered, 2)
})
