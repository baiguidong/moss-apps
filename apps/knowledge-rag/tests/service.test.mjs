import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeService, pageContent, relativeDocument } from '../src/backend/service.mjs'
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
