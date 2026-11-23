import http from 'node:http'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

// Short-lived capabilities only point at immutable App files or a single recording.
export async function createTransfer() {
  const entries = new Map(),
    lifetime = 60 * 60_000
  async function serve(req, res) {
    const origin = req.headers.origin
    if (
      req.headers.host !== base.host ||
      (origin &&
        !/^moss-app:\/\/[a-z0-9-]+$/.test(origin) &&
        !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin))
    ) {
      res.writeHead(403).end()
      return
    }
    const url = new URL(req.url, base),
      entry = entries.get(url.pathname.slice(1))
    if (!entry || entry.expires < Date.now()) {
      res.writeHead(404).end()
      return
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', entry.append ? 'POST, OPTIONS' : 'GET, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    if (!entry.append && req.method === 'GET') {
      res.setHeader('Content-Type', entry.type)
      res.setHeader('Content-Length', (await fs.stat(entry.file)).size)
      await pipeline(createReadStream(entry.file), res)
    } else if (entry.append && req.method === 'POST') {
      const seq = url.searchParams.get('part')
      if (seq !== String(entry.parts) || entry.writing) {
        res.writeHead(409).end()
        return
      }
      const size = Number(req.headers['content-length'])
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > 4 * 1024 * 1024 ||
        entry.bytes + size > entry.max
      ) {
        res.writeHead(413).end()
        return
      }
      entry.writing = true
      try {
        const chunks = []
        let count = 0
        for await (const piece of req) {
          count += piece.length
          if (count > size) throw new Error('分片大小错误')
          chunks.push(piece)
        }
        if (count !== size || !entries.has(entry.id)) throw new Error('上传已中断')
        await fs.appendFile(entry.file, Buffer.concat(chunks), { mode: 0o600 })
        entry.parts++
        entry.bytes += size
        entry.onPart?.()
        res.writeHead(204).end()
      } finally {
        entry.writing = false
      }
    } else res.writeHead(405).end()
  }
  const server = http.createServer((req, res) => {
    void serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400)
      res.end()
    })
  })
  await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', ok)
  })
  const base = new URL('http://127.0.0.1:' + server.address().port)
  function issue(params) {
    for (const [id, e] of entries) if (e.expires < Date.now()) entries.delete(id)
    const id = randomUUID(),
      entry = {
        ...params,
        id,
        url: new URL(id, base).href,
        expires: Date.now() + lifetime,
        parts: 0,
        bytes: 0,
      }
    entries.set(id, entry)
    return entry
  }
  return {
    read: (file, type) => issue({ file, type }).url,
    write: (file, max, onPart) => issue({ file, max, onPart, append: true }),
    revoke: (id) => entries.delete(id),
    close: () => {
      entries.clear()
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}
