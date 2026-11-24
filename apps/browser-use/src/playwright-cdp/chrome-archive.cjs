const fs = require('node:fs/promises')
const { createReadStream, createWriteStream } = require('node:fs')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const path = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { promisify } = require('node:util')
const lock = require('./chrome.lock.json')
const exec = promisify(execFile)
const platform = `${process.platform}-${process.arch}`
const chrome = lock.platforms[platform]

async function verifyArchive(file, signal) {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size !== chrome.size) throw new Error('专用浏览器安装文件大小不匹配。')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  if (hash.digest('hex') !== chrome.sha256) throw new Error('专用浏览器安装文件校验失败。')
}

async function stageArchive(source, destination, signal) {
  let size = 0
  const limit = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length
    callback(size > chrome.size ? new Error('专用浏览器安装文件超出预期大小。') : null, chunk)
  } })
  await pipeline(source, limit, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal })
  await verifyArchive(destination, signal)
}

async function downloadArchive(destination, signal) {
  let failure
  for (const base of lock.sources) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(240_000)
    const attempt = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetch(`${base}/${lock.version}/${chrome.archive}`, { signal: attempt })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`HTTP ${response.status}`)
      }
      await stageArchive(response.body, destination, attempt)
      return
    } catch (error) {
      failure = error
      await fs.rm(destination, { force: true })
    }
  }
  signal?.throwIfAborted()
  throw new Error('无法下载专用浏览器。请检查网络后重试，或安装对应平台的离线包。', { cause: failure })
}

async function stageChromeArchive(destination, signal) {
  const manifest = require('../../app.moss.json')
  const appRoot = path.resolve(__dirname, '../..')
  // The Host keeps offline resources beside the immutable App versions.
  const directory = path.join(appRoot, '../../offline-kits')
  const entries = path.basename(path.dirname(appRoot)) === 'versions'
    ? await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error }) : []
  let invalidKit
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${manifest.version}-`)) continue
    const root = path.join(directory, entry.name)
    try {
      const markerFile = path.join(root, 'offline.json')
      if ((await fs.stat(markerFile)).size > 64 * 1024) throw new Error('离线包清单过大。')
      const marker = JSON.parse(await fs.readFile(markerFile, { encoding: 'utf8', signal }))
      if (marker?.format !== 1 || marker.appId !== manifest.id || marker.version !== manifest.version
        || marker.platform !== platform || marker.browserVersion !== lock.version || !Array.isArray(marker.resources)
        || marker.resources.length !== Math.ceil(chrome.size / (96 * 1024 ** 2))
        || !marker.resources.every((file, i) => file === `browser.part-${String(i).padStart(3, '0')}`)) throw new Error('离线包不匹配。')
      const parts = Readable.from((async function* () {
        for (const file of marker.resources) yield* createReadStream(path.join(root, file), { signal })
      })())
      await stageArchive(parts, destination, signal)
      return
    } catch (error) {
      signal?.throwIfAborted()
      invalidKit = error
      await fs.rm(destination, { force: true })
    }
  }
  if (invalidKit) throw new Error('离线包内的专用浏览器校验失败，请重新安装离线包。', { cause: invalidKit })
  await downloadArchive(destination, signal)
}

async function extractChrome(destination, archive, signal) {
  // Use the pinned Playwright extractor so the browser works without an OS ZIP tool.
  const bundle = path.join(__dirname, 'node_modules', 'playwright-core', 'lib', 'coreBundle.js')
  await exec(process.execPath, ['-e', `require(process.argv[1]).utils.extractZip(process.argv[2], { dir: process.argv[3] })
    .catch(error => { console.error(error.message); process.exitCode = 1 })`, bundle, archive, destination], { signal, timeout: 120_000 })
}

module.exports = { lock, platform, chrome, stageChromeArchive, downloadArchive, extractChrome }
