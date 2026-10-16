import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { inspect, validate, execute } from '../src/backend/engine.mjs'

test('merge, select, rotate and split produce real PDFs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-pdf-'))
  try {
    const doc = await PDFDocument.create(); doc.addPage([300, 400]); doc.addPage([500, 600]); const source = path.join(dir, 'input.pdf'); await fs.writeFile(source, await doc.save())
    const file = { id: 'pdf', path: source, name: 'input.pdf', ...(await inspect(source)) }
    const options = { pages: [{ fileId: 'pdf', page: 1, rotation: 90 }, { fileId: 'pdf', page: 0, rotation: 0 }] }
    const input = validate({ fileIds: ['pdf'], options }, [file]), context = { files: [file], outputDir: dir, signal: new AbortController().signal, progress() {} }
    const result = await execute({ ...context, input }), output = await PDFDocument.load(await fs.readFile(result.files[0].path))
    assert.equal(output.getPageCount(), 2); assert.equal(output.getPage(0).getWidth(), 500); assert.equal(output.getPage(0).getRotation().angle, 90)
    const split = await execute({ ...context, input: validate({ fileIds: ['pdf'], options: { ...options, mode: 'split' } }, [file]) }); assert.equal(split.files.length, 2)
    for (const item of split.files) assert.equal((await PDFDocument.load(await fs.readFile(item.path))).getPageCount(), 1)
    assert.throws(() => validate({ fileIds: ['pdf'], options: { pages: [{ fileId: 'pdf', page: 100, rotation: 0 }] } }, [file]), /无效/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('offline OCR generates a readable text layer and sidecar text', { timeout: 90000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-ocr-'))
  try {
    const doc = await PDFDocument.create(), page = doc.addPage([600, 300])
    const canvas = createCanvas(1200, 600), drawing = canvas.getContext('2d')
    drawing.fillStyle = 'white'; drawing.fillRect(0, 0, 1200, 600); drawing.fillStyle = 'black'; drawing.font = '64px Arial'; drawing.fillText('LOCAL DOCUMENT TEST', 90, 240)
    const scan = await doc.embedPng(canvas.toBuffer('image/png')); page.drawImage(scan, { x: 0, y: 0, width: 600, height: 300 })
    const source = path.join(dir, 'scan.pdf'); await fs.writeFile(source, await doc.save())
    const file = { id: 'scan', path: source, name: 'scan.pdf', ...(await inspect(source)) }
    const result = await execute({ input: validate({ fileIds: ['scan'], options: { mode: 'ocr', language: 'eng' } }, [file]), files: [file], outputDir: dir, signal: new AbortController().signal, progress() {} })
    assert.match(await fs.readFile(result.files.find(f => f.kind === 'text').path, 'utf8'), /LOCAL DOCUMENT TEST/)
    assert.equal((await PDFDocument.load(await fs.readFile(result.files.find(f => f.kind === 'pdf').path))).getPageCount(), 1)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const output = await getDocument({ data: new Uint8Array(await fs.readFile(result.files[0].path)) }).promise
    try { assert.match((await (await output.getPage(1)).getTextContent()).items.map(t => t.str).join(' '), /LOCAL.*DOCUMENT.*TEST/) } finally { await output.destroy() }
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
