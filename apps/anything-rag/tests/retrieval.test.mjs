import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
process.env.MOSS_RAG_DISABLE_NATIVE = '1'
import { RagService } from '../src/backend/service.mjs'
import { parseFile, splitText } from '../src/backend/parsers.mjs'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-test-'))
  const file = path.join(root, '续费政策.md')
  await fs.writeFile(file, '# 续费政策\n\n老用户续费可以申请培训和 15% 优惠。\n\n需要在到期前回访。')
  const service = new RagService({ dataDir: path.join(root, 'app') })
  await service.initialize()
  return { root, file, service }
}

test('splitText preserves metadata and overlap bounds', () => {
  const chunks = splitText('第一段。'.repeat(300), { chunkSize: 100, overlap: 20, title: '测试', source: 'a.md' })
  assert.ok(chunks.length > 1)
  assert.equal(chunks[0].metadata.title, '测试')
  assert.ok(chunks.every(chunk => chunk.content.length <= 100))
})

test('parses HTML and Office XML text without a heavyweight office runtime', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-parser-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const html = path.join(root, 'page.html')
  const docx = path.join(root, 'note.docx')
  await fs.writeFile(html, '<h1>中文标题</h1><p>正文内容</p><script>ignored()</script>')
  await fs.writeFile(docx, zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:t>Office 中文内容</w:t></w:p></w:document>') }))
  assert.match(await parseFile(html), /中文标题.*正文内容/)
  assert.match(await parseFile(docx), /Office 中文内容/)
})

test('never indexes PDF object syntax when text extraction fails', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-pdf-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const pdf = path.join(root, 'broken.pdf')
  await fs.writeFile(pdf, '%PDF-1.4\n2 0 obj\n<</Type/Pages/Count 2>>\nendobj\nxref\n')
  await assert.rejects(() => parseFile(pdf), error => {
    assert.match(error.message, /未找到可读文本|扫描 PDF/)
    assert.doesNotMatch(error.message, /endobj|xref/)
    return true
  })
})

test('passes the PDF path to the compatibility parser', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-pdf-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const pdf = path.join(root, '中文 PDF.pdf')
  const parserPath = path.join(root, 'parser.cjs')
  const expected = '兼容解析器提取的正文'
  await fs.writeFile(pdf, `%PDF-1.4\n${expected}`)
  // Stand in for the managed Python executable so the test can run without Python.
  await fs.writeFile(parserPath, String.raw`
    const { readFileSync } = require('node:fs')
    const text = readFileSync(process.argv[3], 'utf8').split('\n').at(-1)
    console.log(JSON.stringify({ text }))
  `)
  const python = { resolve: async () => ({ parserPath, pythonPath: process.execPath }) }
  assert.equal(await parseFile(pdf, { python }), expected)
})

test('indexes OCR text by page and reuses it when rebuilding the index', async t => {
  const { root, service } = await fixture()
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }) })
  const pdf = path.join(root, '扫描档案.pdf')
  await fs.writeFile(pdf, '%PDF-1.4\n')
  let calls = 0
  service.recognizePdf = async staged => {
    assert.equal(path.basename(staged), '扫描档案.pdf')
    assert.equal(await fs.readFile(staged, 'utf8'), '%PDF-1.4\n')
    calls++
    return [{ page: 1, text: '设备说明' }, { page: 2, text: 'COUPLING BEARING' }]
  }
  const { written, failed } = await service.importFiles({ paths: [pdf] })
  assert.deepEqual(failed, [])
  assert.match((await service.readDocument({ id: written[0].id })).content, /第 2 页\nCOUPLING BEARING/)
  assert.equal((await service.search({ query: 'COUPLING BEARING' })).items[0].page, 2)

  await service.rebuild()
  assert.equal(calls, 1)
  assert.equal((await service.search({ query: 'COUPLING BEARING' })).items[0].page, 2)
})

test('imports a Chinese document and returns hybrid evidence with a Moss URI', async t => {
  const { file, service } = await fixture()
  t.after(() => service.close())
  const imported = await service.importFiles({ paths: [file] })
  assert.equal(imported.written.length, 1)
  assert.equal(imported.failed.length, 0)
  const result = await service.search({ query: '老用户续费有哪些优惠' })
  assert.equal(result.accepted, true)
  assert.equal(result.items[0].filename, '续费政策.md')
  assert.match(result.items[0].uri, /^moss-rag:\/\/resource\//)
  assert.ok(result.items[0].lexicalScore >= 0)
})

test('refuses an unrelated query when no evidence passes threshold', async t => {
  const { file, service } = await fixture()
  t.after(() => service.close())
  await service.importFiles({ paths: [file] })
  const result = await service.search({ query: '火星探测器的燃料配方', threshold: 0.99 })
  assert.equal(result.accepted, false)
  assert.match(result.refusal, /没有找到足够相关的资料/)
})

test('revision guard rejects stale deletion', async t => {
  const { file, service } = await fixture()
  t.after(() => service.close())
  const { written } = await service.importFiles({ paths: [file] })
  await assert.rejects(() => service.deleteDocument({ id: written[0].id, revision: 99 }), /版本已变化/)
})

test('resource resolve returns a Moss file resource and managed delete removes its copy', async t => {
  const { file, service } = await fixture()
  t.after(() => service.close())
  const { written } = await service.importFiles({ paths: [file] })
  const document = await service.readDocument({ id: written[0].id })
  const resource = service.resolveResource({ uri: document.uri })
  assert.equal(resource.kind, 'file')
  assert.equal(resource.resourceId, written[0].id)
  assert.match(resource.path, /documents/)
  await service.deleteDocument({ id: written[0].id, revision: written[0].revision })
  await assert.rejects(() => fs.access(resource.path))
})

test('cancels an active import and persists the cancelled job state', async t => {
  const { file, service } = await fixture()
  t.after(() => service.close())
  service.engine.embed = async values => {
    await new Promise(resolve => setTimeout(resolve, 30))
    return values.map(() => [1, 0])
  }
  const importing = service.importFiles({ paths: [file, file] })
  await new Promise(resolve => setTimeout(resolve, 5))
  await service.cancel()
  const result = await importing
  assert.equal(result.cancelled, true)
  assert.equal(service.listJobs().jobs[0].status, 'cancelled')
})
