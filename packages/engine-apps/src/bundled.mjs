// Large native assets stay inside the App ZIP, split below the Host file limit.
// Restoration is offline, bounded, hash verified and atomic.
import fs from 'node:fs/promises'
import {createReadStream, createWriteStream} from 'node:fs'
import path from 'node:path'
import {randomUUID, createHash} from 'node:crypto'
import {Readable, Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createGunzip} from 'node:zlib'

export async function assetHash(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function restoreBundledAsset(bundled, cached, sha256, signal) {
  signal?.throwIfAborted()
  for (const file of [bundled, cached]) {
    if (!await fs.stat(file).catch(() => null)) continue
    if (await assetHash(file) !== sha256) throw new Error('随包资源校验失败，请重新安装完整 App 包')
    signal?.throwIfAborted(); return file
  }
  const descriptor = await fs.readFile(bundled + '.bundle.json', 'utf8').then(JSON.parse).catch(() => null)
  if (!descriptor) throw new Error('安装包缺少本地资源，请重新安装完整 App 包')
  if (descriptor.schemaVersion !== 1 || descriptor.sha256 !== sha256 || !Number.isSafeInteger(descriptor.size)
    || descriptor.size < 1 || descriptor.size > 1024 ** 3 || !Array.isArray(descriptor.parts)
    || !descriptor.parts.length || descriptor.parts.length > 32) throw new Error('随包资源描述无效')
  await fs.mkdir(path.dirname(cached), {recursive:true, mode:0o700})
  const temporary = cached + '.' + randomUUID() + '.tmp'
  const hash = createHash('sha256'); let bytes = 0
  async function* chunks() {
    for (let i = 0; i < descriptor.parts.length; i++) {
      const part = descriptor.parts[i], file = bundled + `.part-${i}`
      if (!Number.isSafeInteger(part.size) || part.size < 1 || part.size > 64 * 1024 ** 2
        || (await fs.stat(file)).size !== part.size) throw new Error('随包资源分片大小错误')
      const checksum = createHash('sha256')
      for await (const chunk of createReadStream(file)) { signal?.throwIfAborted(); checksum.update(chunk); yield chunk }
      if (checksum.digest('hex') !== part.sha256) throw new Error('随包资源分片校验失败')
    }
  }
  try {
    await pipeline(Readable.from(chunks()), createGunzip(), new Transform({transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > descriptor.size) return callback(new Error('随包资源解压超过声明大小'))
      hash.update(chunk); callback(null, chunk)
    }}), createWriteStream(temporary, {flags:'wx', mode:0o700}), {signal})
    if (bytes !== descriptor.size || hash.digest('hex') !== sha256) throw new Error('随包资源解压校验失败')
    signal?.throwIfAborted(); await fs.rename(temporary, cached); return cached
  } finally { await fs.rm(temporary, {force:true}) }
}
