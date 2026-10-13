import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const app = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(app, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const { Client } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')))
const { StdioClientTransport } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')))
const manifest = JSON.parse(await readFile(join(app, 'app.moss.json'), 'utf8'))
const packageRoot = join(repo, 'artifacts/moss.browser-use', manifest.version, 'package')
const require = createRequire(import.meta.url)
const { installedExecutable } = require(join(packageRoot, 'dist/playwright-cdp/managed.cjs'))
const temporary = await mkdtemp(join(tmpdir(), 'moss-managed-browser-'))
const fixture = await startMcpFixture(), clients = []
const reserve = createServer()
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${reserve.address().port}`
await new Promise(resolve => reserve.close(resolve))
const chromePids = () => process.platform === 'darwin' ? execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n')
  .filter(line => /\/Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome(?: |$)/.test(line)).map(line => Number(line.trim().split(/\s+/)[0])) : []
const normalPids = chromePids()
const bookmarks = join(homedir(), 'Library/Application Support/Google/Chrome/Default/Bookmarks')
const bookmarksBefore = await readFile(bookmarks).catch(() => null)
let observer, websocket
async function connect() {
  const client = new Client({ name: 'managed-browser-test', version: manifest.version })
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(packageRoot, 'dist/playwright-cdp/cli.cjs'), '--moss-managed-browser', '--cdp-endpoint', endpoint, '--headless', '--output-dir', temporary],
    env: { ...process.env, MOSS_HOME: temporary }, stderr: 'pipe' })
  clients.push(client)
  await client.connect(transport)
  return client
}
async function assertBrowserClosed(message) {
  await assert.rejects(fetch(`${endpoint}/json/version`), undefined, message)
}
async function closeOwnedBrowser() {
  if (!websocket) return
  const socket = new WebSocket(websocket)
  await new Promise(resolve => {
    const timer = setTimeout(() => { socket.close(); resolve() }, 5000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })))
    socket.addEventListener('close', () => { clearTimeout(timer); resolve() })
    // Chromium may exit without a WebSocket close frame. Verify the endpoint is
    // closed below instead of treating that transport error as a browser failure.
    socket.addEventListener('error', () => { clearTimeout(timer); resolve() })
  })
  websocket = undefined
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${endpoint}/json/version`) } catch { return }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Test browser still listening')
}
try {
  const executable = await installedExecutable()
  assert.ok(executable, 'Prepare the pinned Playwright chromium before running this test')
  let bundleId
  if (process.platform === 'darwin') {
    bundleId = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', resolve(dirname(executable), '../Info.plist')], { encoding: 'utf8' }).trim()
    assert.notEqual(bundleId, 'com.google.Chrome', 'managed Chrome must have a different application identity')
    assert.equal(bundleId, 'com.google.chrome.for.testing')
  }
  const [first, second] = await Promise.all([connect(), connect()])
  await assertBrowserClosed('MCP initialization must not launch Chrome')
  const toolCount = (await first.listTools()).tools.length
  assert.ok(toolCount > 0)
  assert.equal((await second.listTools()).tools.length, toolCount)
  const idle = await connect(); await idle.listTools(); await idle.close()
  await assertBrowserClosed('tool discovery and idle reconnect must not launch Chrome')
  assert.ok(!(await readdir(temporary)).includes('browser-profiles'), 'discovery must not create a managed profile')
  const starts = await Promise.all([first, second].map(client => client.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })))
  for (const result of starts) assert.ok(!result.isError, JSON.stringify(result))
  websocket = (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl
  const firstSocket = websocket
  assert.equal((await (await fetch(`${endpoint}/json/list`)).json()).filter(tab => tab.type === 'page').length, 1, 'concurrent starts must create only one browser window')
  observer = await chromium.connectOverCDP(endpoint)
  const context = observer.contexts()[0]
  await context.addCookies([{ name: 'managed_login', value: 'keep-login', url: fixture.url, expires: Date.now() / 1000 + 86400 }])
  const result = await first.callTool({ name: 'browser_navigate', arguments: { url: `${fixture.url}/browser` } })
  assert.ok(!result.isError, JSON.stringify(result))
  const page = context.pages().find(page => page.url().startsWith(fixture.url))
  await page.evaluate(() => localStorage.setItem('moss-remembered-setting', 'keep-setting'))
  await first.close(); await second.close()
  assert.equal((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, firstSocket)
  const third = await connect(); await third.close()
  assert.equal((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, firstSocket, 'MCP reconnect must reuse the managed instance')
  await observer.close(); observer = undefined
  await closeOwnedBrowser()
  const fourth = await connect()
  await fourth.listTools()
  await assertBrowserClosed('reconnecting and listing tools after a browser quit must not reopen Chrome')
  const reopened = await fourth.callTool({ name: 'browser_navigate', arguments: { url: `${fixture.url}/browser` } })
  assert.ok(!reopened.isError, JSON.stringify(reopened))
  websocket = (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl
  assert.notEqual(websocket, firstSocket)
  observer = await chromium.connectOverCDP(endpoint)
  assert.ok((await observer.contexts()[0].cookies(fixture.url)).some(cookie => cookie.name === 'managed_login' && cookie.value === 'keep-login'), 'website login must survive browser restart')
  const reloaded = await observer.contexts()[0].newPage()
  await reloaded.goto(`${fixture.url}/browser`)
  assert.equal(await reloaded.evaluate(() => localStorage.getItem('moss-remembered-setting')), 'keep-setting')
  // Keep the MCP client alive while the user quits the browser. The next request
  // in the same conversation must recover without restarting the MCP process.
  assert.ok(!(await fourth.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })).isError)
  const beforeQuit = websocket
  await observer.close(); observer = undefined
  await closeOwnedBrowser()
  await fourth.listTools()
  await assertBrowserClosed('the live MCP client must not reopen Chrome while refreshing tools')
  const resumed = await fourth.callTool({ name: 'browser_navigate', arguments: { url: `${fixture.url}/browser` } })
  assert.ok(!resumed.isError, JSON.stringify(resumed))
  websocket = (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl
  assert.notEqual(websocket, beforeQuit)
  observer = await chromium.connectOverCDP(endpoint)
  const recoveredContext = observer.contexts()[0]
  assert.ok((await recoveredContext.cookies(fixture.url)).some(cookie => cookie.name === 'managed_login' && cookie.value === 'keep-login'))
  const recoveredPage = recoveredContext.pages().find(page => page.url().startsWith(fixture.url))
  assert.equal(await recoveredPage.evaluate(() => localStorage.getItem('moss-remembered-setting')), 'keep-setting')
  await recoveredPage.evaluate(() => { window.reviewClickCount = 0; document.querySelector('button').addEventListener('click', () => window.reviewClickCount++) })
  assert.ok(!(await fourth.callTool({ name: 'browser_type', arguments: { target: '#name', text: 'Recovered' } })).isError)
  assert.ok(!(await fourth.callTool({ name: 'browser_click', arguments: { target: 'button' } })).isError)
  assert.equal(await recoveredPage.evaluate(() => window.reviewClickCount), 1)
  await fourth.close()
  assert.deepEqual(chromePids(), normalPids, 'the user Chrome must neither restart nor be used as the managed browser')
  if (bookmarksBefore) assert.deepEqual(await readFile(bookmarks), bookmarksBefore)
  const report = { passed: true, toolCount, bundleId, checks: ['no browser launch on MCP initialization, tool discovery or idle reconnect', 'no profile creation before automation', 'first automation request launches Chrome', 'separate application identity', 'one instance for concurrent starts', 'same instance on MCP reconnect', 'same profile on browser restart', 'persistent login cookie and localStorage survive restart', 'same MCP client recovers only on automation after the browser quits', 'recovered actions execute once', 'user Chrome process unchanged', 'user bookmarks unchanged'] }
  const output = join(repo, 'artifacts/moss.browser-use/verification', manifest.version)
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'managed-browser.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  await Promise.allSettled(clients.map(client => client.close()))
  await observer?.close()
  if (!websocket) { try { websocket = (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl } catch {} }
  await closeOwnedBrowser()
  await fixture.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
