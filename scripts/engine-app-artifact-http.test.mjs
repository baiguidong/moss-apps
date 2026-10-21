import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { sendArtifact } from '../packages/engine-apps/src/artifact-http.mjs'

test('artifact HTTP serves media byte ranges, HEAD and empty files without leaking file handles', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-http-'))
  const media = path.join(root, 'sample.mp4'), empty = path.join(root, 'empty.wav')
  const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')
  await Promise.all([fs.writeFile(media, bytes), fs.writeFile(empty, '')])
  const server = http.createServer((req, res) => {
    const file = req.url === '/empty' ? empty : req.url === '/missing' ? path.join(root, 'missing') : media
    void sendArtifact(req, res, file).catch(error => {
      if (!res.headersSent) { res.writeHead(404); res.end() }
      else res.destroy(error)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (pathname, options) => fetch(base + pathname, options)

  const full = await request('/media')
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(full.headers.get('content-type'), 'video/mp4')
  assert.equal(full.headers.get('content-length'), String(bytes.length))
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)

  const head = await request('/media', { method: 'HEAD', headers: { Range: 'bytes=5-9' } })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), String(bytes.length))
  assert.equal((await head.arrayBuffer()).byteLength, 0)

  for (const [header, start, end] of [
    ['bytes=5-9', 5, 9], ['bytes=25-', 25, bytes.length - 1],
    ['bytes=-4', bytes.length - 4, bytes.length - 1], ['bytes=0-9999', 0, bytes.length - 1],
  ]) {
    const response = await request('/media', { headers: { Range: header } })
    assert.equal(response.status, 206, header)
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`)
    assert.equal(response.headers.get('content-length'), String(end - start + 1))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1))
  }

  for (const header of ['bytes=999-', 'bytes=8-3', 'bytes=-0']) {
    const response = await request('/media', { headers: { Range: header } })
    assert.equal(response.status, 416, header)
    assert.equal(response.headers.get('content-range'), `bytes */${bytes.length}`)
    assert.equal((await response.arrayBuffer()).byteLength, 0)
  }
  for (const headers of [{ Range: 'bytes=0-1,3-4' }, { Range: 'items=0-1' },
    { Range: 'bytes=0-2', 'If-Range': 'unknown-validator' }]) {
    const response = await request('/media', { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  }

  const zero = await request('/empty')
  assert.equal(zero.status, 200)
  assert.equal(zero.headers.get('content-length'), '0')
  assert.equal((await zero.arrayBuffer()).byteLength, 0)
  const zeroHead = await request('/empty', { method: 'HEAD' })
  assert.equal(zeroHead.status, 200)
  assert.equal(zeroHead.headers.get('content-length'), '0')
  const zeroRange = await request('/empty', { headers: { Range: 'bytes=0-' } })
  assert.equal(zeroRange.status, 416)
  assert.equal(zeroRange.headers.get('content-range'), 'bytes */0')

  assert.equal((await request('/missing')).status, 404)
  assert.equal((await request('/media', { headers: { Range: 'bytes=0-0' } })).status, 206)
})
