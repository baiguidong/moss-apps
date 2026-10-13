const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const { homedir } = require('node:os')
const { createRequire } = require('node:module')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const http = require('node:http')
const exec = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const root = () => process.env.MOSS_HOME || path.join(homedir(), '.moss')

function option(args, name) {
  let value
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1] && !args[i + 1].startsWith('--')) value = args[i + 1]
    else if (args[i].startsWith(name + '=')) value = args[i].slice(name.length + 1)
  }
  return value
}

function corePath() {
  const mcp = require.resolve('@playwright/mcp/package.json')
  return path.dirname(createRequire(mcp).resolve('playwright-core/package.json'))
}

async function installedExecutable() {
  const core = corePath()
  const { stdout } = await exec(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).chromium.executablePath())', core], { timeout: 10_000 })
  const executable = stdout.trim()
  try {
    await fs.access(executable, constants.X_OK)
    let directory = path.dirname(executable)
    for (let i = 0; i < 7; i++, directory = path.dirname(directory)) {
      try { await fs.access(path.join(directory, 'INSTALLATION_COMPLETE')); return executable } catch {}
    }
  } catch {}
  return null
}

async function prepareManagedBrowser({ signal } = {}) {
  const installed = await installedExecutable()
  if (installed) return installed
  // Playwright installs its pinned Chrome for Testing, with its own application
  // identity. Never search for or fall back to the customer's Google Chrome.
  const logs = path.join(root(), 'browser-profiles')
  await fs.mkdir(logs, { recursive: true, mode: 0o700 })
  const logFile = path.join(logs, 'browser-install.log')
  try {
    const result = await exec(process.execPath, [path.join(corePath(), 'cli.js'), 'install', 'chromium', '--no-shell'], {
      signal, timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
    })
    await fs.writeFile(logFile, result.stdout + result.stderr, { mode: 0o600 })
  } catch (error) {
    await fs.writeFile(logFile, String(error.stdout || '') + String(error.stderr || error.message), { mode: 0o600 })
    throw new Error(`专用浏览器下载未完成，请检查网络后重新连接。日志：${logFile}`)
  }
  const executable = await installedExecutable()
  if (!executable) throw new Error('专用浏览器安装不完整，请重新连接以重试。')
  return executable
}

function probe(endpoint) {
  return new Promise(resolve => {
    const request = http.get(`${endpoint}/json/version`, { timeout: 700, agent: false }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk; if (body.length > 65536) request.destroy() })
      response.on('end', () => {
        try { const info = JSON.parse(body); resolve(response.statusCode === 200 && /^ws:\/\//.test(info.webSocketDebuggerUrl) ? info : 'occupied') }
        catch { resolve('occupied') }
      })
      response.on('error', () => resolve('occupied'))
    })
    request.on('timeout', () => { resolve('occupied'); request.destroy() })
    request.on('error', error => resolve(error.code === 'ECONNREFUSED' ? null : 'occupied'))
  })
}

async function acquireLock(file, deadline) {
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      await handle.writeFile(String(process.pid)); await handle.close()
      return () => fs.unlink(file).catch(() => {})
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = Number(await fs.readFile(file, 'utf8').catch(() => ''))
      if (owner > 0) {
        try { process.kill(owner, 0) }
        catch (cause) { if (cause.code === 'ESRCH') await fs.unlink(file).catch(() => {}) }
      } else {
        const stat = await fs.stat(file).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > 30_000) await fs.unlink(file).catch(() => {})
      }
      await delay(100)
    }
  }
  throw new Error('等待专用浏览器启动超时，请重新连接。')
}

function managedBrowserConfig(args, options) {
  const url = new URL(option(args, '--cdp-endpoint') || 'http://127.0.0.1:9222')
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/' || url.search || url.username || url.password) {
    throw new Error('专用浏览器仅支持本机 CDP 地址；连接远程浏览器请选择已有 CDP 服务。')
  }
  if (option(args, '--executable-path') || option(args, '--user-data-dir')) throw new Error('专用模式使用受管浏览器和固定用户目录；使用客户 Chrome 请选择日常 Chrome。')
  const endpoint = `http://127.0.0.1:${url.port || 80}`
  const profile = path.join(options.root || root(), 'browser-profiles', `playwright-cdp-${url.port || 80}`)
  return { url, endpoint, profile }
}

async function ensureManagedBrowser(args, options = {}) {
  const { url, endpoint, profile } = managedBrowserConfig(args, options)
  await fs.mkdir(profile, { recursive: true, mode: 0o700 })
  const release = await acquireLock(path.join(profile, '.moss-start.lock'), Date.now() + 30_000)
  try {
    const status = await (options.probe || probe)(endpoint)
    const stateFile = path.join(profile, 'moss-browser.json')
    const state = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null)
    if (status) {
      if (status !== 'occupied' && state?.webSocketDebuggerUrl === status.webSocketDebuggerUrl && state?.kind === 'chrome-for-testing') return { endpoint, profile, mode: 'reused', version: status }
      throw new Error(`端口 ${url.port || 80} 已由其他浏览器或服务使用。请先关闭旧版 Moss 自动化窗口，或在高级设置中更换专用浏览器端口。Moss 不会关闭日常 Chrome。`)
    }
    const executable = await (options.prepare || prepareManagedBrowser)({})
    const log = await fs.open(path.join(profile, 'chrome-launch.log'), 'a', 0o600)
    let child, failure
    try {
      child = (options.spawn || spawn)(executable, [`--remote-debugging-port=${url.port || 80}`, '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        ...(args.includes('--headless') ? ['--headless=new'] : []), ...(args.includes('--no-sandbox') ? ['--no-sandbox'] : []), 'about:blank'],
      { detached: true, stdio: ['ignore', log.fd, log.fd] })
      child.on('error', error => { failure = error.message }); child.unref()
    } finally { await log.close() }
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const ready = await (options.probe || probe)(endpoint)
      if (ready && ready !== 'occupied') {
        await fs.writeFile(stateFile, JSON.stringify({ kind: 'chrome-for-testing', executable, pid: child.pid, webSocketDebuggerUrl: ready.webSocketDebuggerUrl }), { mode: 0o600 })
        return { endpoint, profile, mode: 'started', version: ready }
      }
      if (failure) throw new Error(`无法启动专用浏览器：${failure}`)
      await delay(100)
    }
    throw new Error(`专用浏览器启动超时，请检查是否有旧版浏览器占用了目录：${profile}`)
  } finally { await release() }
}

// Playwright resolves an HTTP CDP endpoint only when a tool needs the browser.
// MCP initialization and tools/list must not launch Chrome. Keep this endpoint
// alive so the next automation request can open or recover the owned browser.
// Never replay a tool that has already executed.
async function createManagedEndpoint(args, options = {}) {
  managedBrowserConfig(args, options)
  let closed = false
  const server = http.createServer(async (request, response) => {
    if (closed || request.method !== 'GET' || !/^\/json\/version\/?$/.test(request.url)) {
      response.writeHead(404).end(); return
    }
    try {
      const browser = await ensureManagedBrowser(args, options)
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(browser.version))
    } catch (error) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(error.message)
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  server.unref()
  return { endpoint: `http://127.0.0.1:${server.address().port}`, close() {
    closed = true; server.close(); server.closeAllConnections()
  } }
}

module.exports = { prepareManagedBrowser, ensureManagedBrowser, installedExecutable, createManagedEndpoint }
