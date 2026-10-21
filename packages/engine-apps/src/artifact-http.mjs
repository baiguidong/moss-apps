import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

const mime = {
  html: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', flac: 'audio/flac',
}

function singleByteRange(value, size) {
  if (typeof value !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  // Ignore malformed and multipart ranges; HTTP permits a full response.
  if (!match || (!match[1] && !match[2])) return null
  if (size === 0) return { unsatisfied: true }
  const total = BigInt(size)
  if (match[1]) {
    const start = BigInt(match[1])
    if (start >= total) return { unsatisfied: true }
    const requestedEnd = match[2] ? BigInt(match[2]) : total - 1n
    if (requestedEnd < start) return { unsatisfied: true }
    return { start: Number(start), end: Number(requestedEnd < total ? requestedEnd : total - 1n) }
  }
  const suffix = BigInt(match[2])
  if (suffix === 0n) return { unsatisfied: true }
  return { start: Number(suffix >= total ? 0n : total - suffix), end: size - 1 }
}

/** Send an already-authorized local artifact with one byte range per request. */
export async function sendArtifact(req, res, target) {
  // The caller resolves and authorizes the path. Refuse a replaced final symlink.
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  let streaming = false
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('结果不是文件')
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error('结果文件大小无效')
    if (res.destroyed) return

    const size = stat.size
    const range = req.method === 'GET' && !req.headers['if-range']
      ? singleByteRange(req.headers.range, size) : null
    const ext = path.extname(target).slice(1).toLowerCase()
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
    res.setHeader('Accept-Ranges', 'bytes')
    if (range?.unsatisfied) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.setHeader('Content-Length', 0)
      res.end()
      return
    }

    const length = range ? range.end - range.start + 1 : size
    if (range) {
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    }
    res.setHeader('Content-Length', length)
    if (req.method === 'HEAD' || length === 0) { res.end(); return }

    const stream = handle.createReadStream({ start: range?.start ?? 0, end: range?.end ?? size - 1 })
    streaming = true
    stream.once('error', error => { if (!res.destroyed) res.destroy(error) })
    res.once('close', () => { if (!res.writableFinished) stream.destroy() })
    stream.pipe(res)
  } finally {
    if (!streaming) await handle.close()
  }
}
