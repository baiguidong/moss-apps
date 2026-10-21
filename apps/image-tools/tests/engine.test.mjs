import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { inspect, validate, execute } from '../src/backend/engine.mjs'
import { previewImage } from '../src/backend/preview.mjs'
import { LocalTasks } from '@moss/local-tasks/backend'

test('real image conversion, transparency, crop and invalid bounds', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-images-'))
  try {
    const file = path.join(dir, 'input.png'); await sharp({ create: { width: 160, height: 100, channels: 4, background: { r: 200, g: 80, b: 20, alpha: 0 } } }).png().toFile(file)
    const source = { id: 'input', path: file, name: 'input.png', size: (await fs.stat(file)).size, ...(await inspect(file)) }
    const input = validate({ fileIds: ['input'], options: { format: 'jpeg', width: 40, crop: { left: 10, top: 10, width: 80, height: 60 } } }, [source])
    const result = await execute({ input, files: [source], outputDir: dir, signal: new AbortController().signal, progress() {} })
    const output = await sharp(result.files[0].path).metadata(); assert.equal(output.width, 40); assert.equal(output.height, 30); assert.equal(output.hasAlpha, false)
    assert.deepEqual([...await sharp(result.files[0].path).raw().toBuffer()].slice(0, 3), [255, 255, 255])
    assert.throws(() => validate({ fileIds: ['input'], options: { crop: { left: 150, top: 0, width: 30, height: 10 } } }, [source]), /超出/)
    assert.equal((await sharp(file).metadata()).width, 160)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('real task, range preview, export without overwrite and restart persistence', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-tasks-')), source = path.join(dir, 'source.png'), destination = path.join(dir, 'export')
  await sharp({ create: { width: 120, height: 80, channels: 3, background: '#42865d' } }).png().toFile(source); await fs.mkdir(destination)
  const options = { dataDir: path.join(dir, 'data'), worker: fileURLToPath(new URL('../src/backend/worker.mjs', import.meta.url)), inspect, validate }
  let service = await new LocalTasks(options).initialize()
  try {
    const imported = await service.importFiles([source]); const input = imported.files[0]
    const browserPreview = await previewImage(service, input.id)
    assert.match(browserPreview.url, /^data:image\/webp;base64,/)
    assert.equal((await sharp(Buffer.from(browserPreview.url.split(',')[1], 'base64')).metadata()).width, 120)
    await assert.rejects(previewImage(service, 'missing'), /找不到文件/)
    const task = await service.start({ fileIds: [input.id], options: { format: 'webp', width: 60 } })
    for (let n = 0; n < 150 && !['succeeded', 'failed'].includes(service.state.tasks[0].status); n++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(service.state.tasks[0].status, 'succeeded', service.state.tasks[0].message)
    const output = service.overview().files.find(f => f.role === 'output')
    const range = await fetch(output.url, { headers: { Range: 'bytes=0-3' } }); assert.equal(range.status, 206); assert.equal(await range.text(), 'RIFF')
    assert.equal((await fetch(output.url.replace(service.token, 'wrong'))).status, 404)
    assert.equal((await fetch(output.url, { headers: { Origin: 'https://untrusted.example' } })).status, 403)
    assert.equal((await fetch(output.url, { headers: { Range: 'bytes=99999999-' } })).status, 416)
    const host = { request: async () => ({ paths: [destination] }) }
    const first = await service.exportFiles([output.id], host), second = await service.exportFiles([output.id], host)
    assert.notEqual(first.files[0], second.files[0]); assert.deepEqual(await fs.readFile(first.files[0]), await fs.readFile(second.files[0]))
    await service.close(); service = await new LocalTasks(options).initialize()
    assert.equal(service.overview().tasks.find(t => t.id === task.id).status, 'succeeded'); assert.equal(service.overview().files.length, 2)
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('canceling while a queued job prepares files never launches processing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-cancel-'))
  const source = path.join(dir, 'source.tiff')
  await sharp({ create: { width: 30, height: 20, channels: 3, background: '#42865d' } }).tiff().toFile(source)
  const service = await new LocalTasks({ dataDir: path.join(dir, 'data'), worker: fileURLToPath(new URL('../src/backend/worker.mjs', import.meta.url)), inspect, validate }).initialize()
  let release
  try {
    const imported = await service.importFiles([source])
    const preview = await fetch(imported.files[0].previewUrl)
    assert.equal(preview.headers.get('content-type'), 'image/png')
    assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width, 30)
    const filePath = service.filePath.bind(service)
    let entered
    const preparing = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
    service.filePath = async file => { entered(); await gate; return filePath(file) }
    const task = await service.start({ fileIds: [imported.files[0].id], options: {} })
    await preparing; await service.cancel(task.id); release()
    for (let n = 0; service.running && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(service.state.tasks[0].status, 'canceled')
    assert.deepEqual(service.state.tasks[0].outputs, [])
  } finally { release?.(); await service.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('web previews use durable artifacts and inline fallback stays below the App IPC limit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-image-preview-'))
  const source = path.join(dir, 'noise.png')
  const width = 1250, height = 1250
  await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).png().toFile(source)
  const dataDir = path.join(dir, 'data')
  const options = { dataDir, worker: fileURLToPath(new URL('../src/backend/worker.mjs', import.meta.url)), inspect, validate }
  let service
  try {
    service = await new LocalTasks(options).initialize()
    const imported = await service.importFiles([source])
    const originalPreview = await sharp(source).webp({ quality: 76 }).toBuffer()
    assert.ok(originalPreview.length * 4 / 3 > 1024 * 1024)
    const inline = await previewImage(service, imported.files[0].id)
    assert.match(inline.url, /^data:image\/webp;base64,/)
    assert.ok(Buffer.byteLength(JSON.stringify(inline)) < 1024 * 1024)
    await service.close()

    const requested = []
    service = await new LocalTasks({ ...options, artifactUrl: async relative => {
      requested.push(relative)
      return `/_moss/resource/test/${relative}`
    } }).initialize()
    const first = await previewImage(service, imported.files[0].id)
    assert.match(first.url, /^\/_moss\/resource\/test\/previews\/.*\.webp$/)
    const preview = path.join(dataDir, requested.at(-1))
    assert.equal((await sharp(preview).metadata()).width, width)
    const before = (await fs.stat(preview)).mtimeMs
    await service.close()
    service = await new LocalTasks({ ...options, artifactUrl: async relative => `/_moss/resource/test/${relative}` }).initialize()
    assert.equal((await previewImage(service, imported.files[0].id)).url, first.url)
    assert.equal((await fs.stat(preview)).mtimeMs, before)
  } finally { await service?.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('web preview falls back to an original TIFF when its optional imported thumbnail is missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-image-preview-fallback-'))
  const source = path.join(root, 'source.tiff')
  let service
  try {
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#42865d' } }).tiff().toFile(source)
    service = await new LocalTasks({ dataDir: path.join(root, 'data'), worker: '', inspect, validate,
      artifactUrl: async relative => `host://artifact/${relative}`,
    }).initialize()
    const imported = await service.importFiles([source])
    assert.ok(service.state.files[0].previewRelative)
    await fs.rm(path.join(service.root, service.state.files[0].previewRelative))
    const preview = await previewImage(service, imported.files[0].id)
    assert.match(preview.url, /^host:\/\/artifact\/previews\//)
    const output = path.join(service.root, preview.url.slice('host://artifact/'.length))
    assert.equal((await sharp(output).metadata()).width, 40)
  } finally { await service?.close(); await fs.rm(root, { recursive: true, force: true }) }
})
