import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'

const browserArchives = {
  'linux-x64': ['linux64/chrome-linux64.zip', 'chrome-linux64/chrome'],
  'darwin-arm64': ['mac-arm64/chrome-mac-arm64.zip', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
  'darwin-x64': ['mac-x64/chrome-mac-x64.zip', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
  'win32-x64': ['win64/chrome-win64.zip', 'chrome-win64/chrome.exe'],
}
const hash = buffer => createHash('sha256').update(buffer).digest('hex')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 900000, env: { ...process.env, COPYFILE_DISABLE: '1' } })
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed (${result.status})`)
}

function putString(buffer, offset, length, value) {
  const bytes = Buffer.from(value)
  if (bytes.length > length) throw new Error(`Tar header field is too long: ${value}`)
  bytes.copy(buffer, offset)
}

function putOctal(buffer, offset, length, value) {
  const digits = Math.max(0, value).toString(8)
  if (digits.length > length - 1) throw new Error(`Tar header number is too large: ${value}`)
  putString(buffer, offset, length, `${digits.padStart(length - 1, '0')}\0`)
}

function splitTarPath(name) {
  const slash = name.lastIndexOf('/')
  if (Buffer.byteLength(name) <= 100) return { base: name, prefix: '' }
  if (slash > 0 && Buffer.byteLength(name.slice(0, slash)) <= 155 && Buffer.byteLength(name.slice(slash + 1)) <= 100) {
    return { base: name.slice(slash + 1), prefix: name.slice(0, slash) }
  }
  return null
}

function tarHeader(name, stat, type, linkname = '') {
  const fields = splitTarPath(name)
  const base = fields?.base || name.slice(-100)
  const prefix = fields?.prefix || ''
  if (Buffer.byteLength(base) > 100) throw new Error(`Tar path is too long: ${name}`)
  const header = Buffer.alloc(512)
  putString(header, 0, 100, base)
  putOctal(header, 100, 8, stat.mode & 0o7777)
  putOctal(header, 108, 8, 0)
  putOctal(header, 116, 8, 0)
  putOctal(header, 124, 12, type === '0' || type === 'x' ? stat.size : 0)
  putOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  putString(header, 157, 100, linkname)
  putString(header, 257, 6, 'ustar\0')
  putString(header, 263, 2, '00')
  putString(header, 265, 32, 'root')
  putString(header, 297, 32, 'root')
  if (prefix) putString(header, 345, 155, prefix)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  putString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

function paxPathRecord(name) {
  const body = `path=${name}\n`
  let length = Buffer.byteLength(body) + 2
  while (String(length).length + 1 + Buffer.byteLength(body) !== length) length++
  return Buffer.from(`${length} ${body}`)
}

function paxPathHeader(name, stat) {
  const data = paxPathRecord(name)
  const header = tarHeader('PaxHeaders.0/entry', { ...stat, size: data.length }, 'x')
  const padding = (512 - (data.length % 512)) % 512
  return [header, data, padding ? Buffer.alloc(padding) : null]
}

async function* tarEntries(root, current = '.') {
  const directory = current === '.' ? root : path.join(root, current)
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const entry of entries) {
    const relative = current === '.' ? entry.name : `${current}/${entry.name}`
    const file = path.join(root, relative)
    const stat = await fs.lstat(file)
    if (stat.isDirectory()) {
      yield { relative, file, stat, type: '5' }
      yield* tarEntries(root, relative)
    } else if (stat.isFile()) yield { relative, file, stat, type: '0' }
    else if (stat.isSymbolicLink()) yield { relative, file, stat, type: '2', linkname: await fs.readlink(file) }
    else throw new Error(`Unsupported browser archive entry: ${file}`)
  }
}

async function* deterministicTar(root) {
  const rootStat = await fs.lstat(root)
  yield tarHeader('.', rootStat, '5')
  for await (const entry of tarEntries(root)) {
    if (!splitTarPath(entry.relative)) {
      const [header, data, padding] = paxPathHeader(entry.relative, entry.stat)
      yield header
      yield data
      if (padding) yield padding
    }
    yield tarHeader(entry.relative, entry.stat, entry.type, entry.linkname)
    if (entry.type !== '0') continue
    let size = 0
    for await (const chunk of createReadStream(entry.file)) {
      size += chunk.length
      yield chunk
    }
    if (size !== entry.stat.size) throw new Error(`Browser archive entry changed while packaging: ${entry.relative}`)
    const padding = (512 - (size % 512)) % 512
    if (padding) yield Buffer.alloc(padding)
  }
  yield Buffer.alloc(1024)
}

async function writeDeterministicTarGzip(source, destination) {
  await pipeline(Readable.from(deterministicTar(source)), createGzip({ level: 9 }), createWriteStream(destination))
}

export async function bundleBrowser(appRoot, target) {
  const manifest = JSON.parse(await fs.readFile(path.join(appRoot, 'app.moss.json'), 'utf8'))
  const platform = manifest.platforms?.length === 1 ? manifest.platforms[0] : `${process.platform}-${process.arch}`
  const archive = browserArchives[platform]
  if (!archive) throw new Error(`No self-contained browser build for ${platform}`)
  const browsers = JSON.parse(await fs.readFile(path.join(target, 'node_modules/playwright-core/browsers.json'), 'utf8'))
  const chrome = browsers.browsers.find(item => item.name === 'chromium')
  if (!chrome?.browserVersion || !chrome?.revision) throw new Error('Pinned Playwright Chromium version is unavailable')
  const cache = process.env.MOSS_BUILD_DEPENDENCY_CACHE || path.join(os.tmpdir(), 'moss-browser-build-cache')
  await fs.mkdir(cache, { recursive: true })
  const zip = path.join(cache, `chrome-${chrome.browserVersion}-${platform}.zip`)
  if (!(await fs.stat(zip).then(stat => stat.size > 100_000_000, () => false))) {
    const downloaded = `${zip}.${process.pid}.tmp`
    const url = `https://cdn.npmmirror.com/binaries/playwright/builds/cft/${chrome.browserVersion}/${archive[0]}`
    try {
      run('curl', ['-fL', '--retry', '12', '--retry-all-errors', '--continue-at', '-', '--silent', '--show-error', '-o', downloaded, url], appRoot)
      run('unzip', ['-tq', downloaded], appRoot)
      await fs.rename(downloaded, zip)
    } finally { await fs.rm(downloaded, { force: true }) }
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-bundled-browser-'))
  try {
    const extracted = path.join(temporary, 'extracted')
    await fs.mkdir(extracted)
    run('unzip', ['-q', zip, '-d', extracted], appRoot)
    await fs.access(path.join(extracted, archive[1]))
    const compressed = path.join(temporary, 'browser.tar.gz')
    await writeDeterministicTarGzip(extracted, compressed)
    const parts = []
    const input = await fs.open(compressed, 'r')
    const whole = createHash('sha256')
    try {
      for (let index = 0; ; index++) {
        const chunk = Buffer.allocUnsafe(96 * 1024 * 1024)
        const { bytesRead } = await input.read(chunk, 0, chunk.length, index * chunk.length)
        if (!bytesRead) break
        const bytes = chunk.subarray(0, bytesRead)
        const file = `part-${String(index).padStart(3, '0')}`
        await fs.writeFile(path.join(target, file), bytes)
        whole.update(bytes)
        parts.push({ file, size: bytesRead, sha256: hash(bytes) })
      }
    } finally { await input.close() }
    await fs.writeFile(path.join(target, 'browser-bundle.json'), JSON.stringify({ platform, revision: chrome.revision,
      browserVersion: chrome.browserVersion, executable: archive[1], sha256: whole.digest('hex'), parts }, null, 2) + '\n')
    console.log(`Bundled ${platform} Chrome for Testing ${chrome.browserVersion} in ${parts.length} part(s)`)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
