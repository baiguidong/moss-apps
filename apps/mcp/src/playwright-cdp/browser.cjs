const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { homedir, tmpdir } = require('node:os')
const path = require('node:path')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function option(args, name) {
  let value
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1] && !args[index + 1].startsWith('--')) value = args[index + 1]
    else if (args[index].startsWith(`${name}=`)) value = args[index].slice(name.length + 1)
  }
  return value
}

function localEndpoint(value) {
  try {
    const url = new URL(value)
    // Remote, authenticated, proxied and WebSocket endpoints remain connect-only.
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.pathname !== '/' || url.search || url.username || url.password) return null
    const port = Number(url.port || 80)
    return { url: `http://127.0.0.1:${port}`, port }
  } catch { return null }
}

function probeEndpoint(endpoint, timeoutMs = 800) {
  return new Promise(resolve => {
    let done = false
    const finish = value => { if (!done) { done = true; resolve(value) } }
    const request = http.get(`${endpoint}/json/version`, { timeout: timeoutMs, agent: false }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 64 * 1024) { finish('occupied'); request.destroy() }
      })
      response.on('end', () => {
        try {
          const info = JSON.parse(body), socket = new URL(info.webSocketDebuggerUrl)
          finish(response.statusCode === 200 && ['ws:', 'wss:'].includes(socket.protocol) && socket.pathname.startsWith('/devtools/browser/') ? 'ready' : 'occupied')
        } catch { finish('occupied') }
      })
      response.on('error', () => finish('occupied'))
    })
    request.on('timeout', () => { finish('occupied'); request.destroy() })
    request.on('error', error => finish(error.code === 'ECONNREFUSED' ? 'closed' : 'occupied'))
  })
}

function chromeCandidates(platform, env, home) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    paths.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  ]
  if (platform === 'win32') return [...new Set([
    env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local'),
    env.PROGRAMFILES || env.ProgramFiles || 'C:\\Program Files',
    env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  ])].map(root => paths.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  return [...new Set([
    '/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ...(env.PATH || '').split(':').filter(Boolean).flatMap(root => ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'].map(name => paths.join(root, name))),
  ])]
}

async function findChrome(explicit, platform, env, home) {
  for (const candidate of explicit ? [explicit] : chromeCandidates(platform, env, home)) {
    try { await fs.access(candidate, constants.X_OK); return candidate } catch {}
  }
  throw new Error(explicit ? `Chrome 可执行文件不可用：${explicit}` : '未找到系统 Chrome。请安装 Chrome，或在启动参数中通过 --executable-path 指定路径。')
}

async function launchChrome({ executable, profile, port, headless, noSandbox }) {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 })
  const logPath = path.join(profile, 'chrome-launch.log')
  const log = await fs.open(logPath, 'a', 0o600)
  try {
    const child = spawn(executable, [
      `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      ...(headless ? ['--headless=new'] : []), ...(noSandbox ? ['--no-sandbox'] : []),
      'about:blank',
    ], { detached: true, stdio: ['ignore', log.fd, log.fd] })
    const state = { pid: child.pid, logPath, error: null }
    child.on('error', error => { state.error = error.message })
    child.on('exit', (code, signal) => {
      // Chrome may hand off to another process using the same profile. Readiness wins.
      if (code || signal) state.error = `Chrome 退出（${signal || code}）`
    })
    child.unref()
    return state
  } finally { await log.close() }
}

async function acquireLock(file, deadline) {
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      await handle.writeFile(String(process.pid)); await handle.close()
      return async () => { await fs.unlink(file).catch(() => {}) }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = await fs.readFile(file, 'utf8').catch(() => '')
      const pid = Number(owner)
      if (pid > 0) {
        try { process.kill(pid, 0) }
        catch (cause) { if (cause.code === 'ESRCH') await fs.unlink(file).catch(() => {}) }
      } else {
        const stat = await fs.stat(file).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > 30_000) await fs.unlink(file).catch(() => {})
      }
      await delay(100)
    }
  }
  throw new Error('等待其他 MCP 会话启动 Chrome 超时，请重试。')
}

async function ensureBrowser(args, options = {}) {
  const env = options.env || process.env, home = options.home || homedir()
  if (args.some(arg => ['--help', '-h', '--version', '-V', 'install-browser', '--extension'].includes(arg))) return { mode: 'connect-only' }
  const target = localEndpoint(option(args, '--cdp-endpoint') || env.PLAYWRIGHT_MCP_CDP_ENDPOINT)
  if (!target) return { mode: 'connect-only' }
  const probe = options.probe || probeEndpoint
  if (await probe(target.url) === 'ready') return { mode: 'reused' }
  const timeout = options.timeoutMs || Number(option(args, '--cdp-timeout')) || 15_000
  const deadline = Date.now() + Math.max(100, timeout)
  const ownerKey = createHash('sha256').update(home).digest('hex').slice(0, 16)
  const release = await acquireLock(path.join(tmpdir(), `moss-chrome-${ownerKey}-${target.port}.lock`), deadline)
  try {
    const state = await probe(target.url)
    if (state === 'ready') return { mode: 'reused' }
    if (state === 'occupied') throw new Error(`端口 ${target.port} 已被占用，但不是可用的 Chrome CDP 服务。请修改 --cdp-endpoint 的端口。`)
    const executable = await findChrome(option(args, '--executable-path') || env.PLAYWRIGHT_MCP_EXECUTABLE_PATH, options.platform || process.platform, env, home)
    const profile = option(args, '--user-data-dir') || path.join(home, '.moss', 'browser-profiles', `playwright-cdp-${target.port}`)
    const launched = await (options.launch || launchChrome)({ executable, profile, port: target.port,
      headless: args.includes('--headless'), noSandbox: args.includes('--no-sandbox') })
    while (Date.now() < deadline) {
      if (await probe(target.url) === 'ready') return { mode: 'started', pid: launched.pid, profile }
      if (launched.error) throw new Error(`无法启动 Chrome：${launched.error}。日志：${launched.logPath}`)
      await delay(100)
    }
    throw new Error(`Chrome 未能在限定时间内开启 CDP（${target.url}）。请检查浏览器是否占用了该用户目录。日志：${launched.logPath}`)
  } finally { await release() }
}

module.exports = { ensureBrowser, localEndpoint, probeEndpoint, chromeCandidates }
