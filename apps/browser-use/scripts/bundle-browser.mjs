import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
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
    run('tar', ['-czf', compressed, '-C', extracted, '.'], appRoot)
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
