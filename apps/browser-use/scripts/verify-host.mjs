// Install the real archive in an isolated Host, then exercise its startup, UI and MCP tools.
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer as createNetServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(root, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const temporary = await mkdtemp(join(tmpdir(), 'moss-browser-app-'))
process.env.MOSS_HOME = join(temporary, 'moss-home')
const fromCore = relative => import(pathToFileURL(join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const { Client } = await fromCore('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')
const { StdioClientTransport } = await fromCore('node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const executable = await createRequire(import.meta.url)(join(repo, 'artifacts/moss.browser-use', manifest.version, 'package/dist/playwright-cdp/managed.cjs')).installedExecutable()
assert.ok(executable, 'Prepare the pinned Chrome for Testing before running browser verification')
const output = join(repo, 'artifacts/moss.browser-use/verification', manifest.version)
await mkdir(output, { recursive: true })
const reservation = createNetServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${reservation.address().port}`
await new Promise(resolve => reservation.close(resolve))
const fixture = await startMcpFixture()
const runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
  credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
let inspections = 0, registrations = 0, legacyReads = 0
const host = new AppMcpHost({ getRuntime: () => runtime, readLegacy: () => { legacyReads++; return {} },
  inspect: (...args) => { inspections++; return inspectDesktopMcpServer(...args) },
})
for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => {
  if (method === 'servers.save' && context.appId === manifest.id && !input.previousName) {
    registrations++
    assert.equal(input.name, 'playwright-cdp')
    assert.ok(input.config.args.includes('--moss-managed-browser'), 'the packaged App must default to an independently identified managed browser')
    assert.ok(!input.config.args.includes('--user-data-dir'), 'the default must not create a browser profile')
    // Only test addresses/paths are substituted at the Host boundary, keeping the
    // packaged Backend, Host storage, MCP client and launcher real throughout.
    input = { ...input, config: { ...input.config, args: [input.config.args[0], '--moss-managed-browser', '--headless', '--cdp-endpoint', endpoint,
      '--output-dir', join(temporary, 'screenshots')] } }
  }
  return host.handle(method, input, context)
})
const serverName = 'moss_browser_use__playwright-cdp'
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(message)
}
let client, transport, browser, uiServer
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts/moss.browser-use', manifest.version, `moss.browser-use-${manifest.version}.zip`))
  await waitFor(() => host.toolCatalog(manifest.id)[0]?.status === 'connected', 'App startup did not inspect the browser without a UI request')
  assert.equal(registrations, 1)
  assert.equal(legacyReads, 0)
  assert.ok(!runtime.installations.get('moss.mcp'))
  const config = host.enabledServers()[serverName]
  assert.ok(config)
  const instance = (await runtime.listInstances(manifest.id))[0]
  const invoke = async (method, input = {}) => runtime.invoke(manifest.id, instance.id, method, input, { timeoutMs: 65_000 })
  const ready = await invoke('servers.list')
  assert.equal(ready.ok, true)
  assert.equal(ready.data.preparation.state, 'ready')
  assert.equal(ready.data.servers.length, 1)
  await invoke('servers.inspect', { name: 'playwright-cdp' })
  await waitFor(async () => (await invoke('servers.list')).data.preparation.state === 'ready', 'explicit inspection did not finish')
  await runtime.setAppEnabled(manifest.id, false)
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => host.toolCatalog(manifest.id)[0]?.status === 'connected', 'App re-enable did not inspect tools')
  await assert.rejects(fetch(`${endpoint}/json/version`), undefined, 'Host startup, inspection and App re-enable must not open Chrome')

  // Actual browser actions through the packaged MCP, with external network disabled.
  const guard = join(temporary, 'offline.cjs')
  await writeFile(guard, `const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
  if (options?.port && !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost')) throw new Error('External network blocked');
  return connect.apply(this, args);
};\n`)
  transport = new StdioClientTransport({ ...config, env: { ...process.env, PATH: '', npm_config_offline: 'true', npm_config_cache: join(temporary, 'empty-cache'), NODE_OPTIONS: '--require=' + JSON.stringify(guard) }, stderr: 'pipe' })
  client = new Client({ name: 'browser-app-verification', version: manifest.version })
  await client.connect(transport)
  const tools = (await client.listTools()).tools
  assert.ok(tools.some(tool => tool.name === 'browser_click'))
  await assert.rejects(fetch(`${endpoint}/json/version`), undefined, 'MCP connection and tools/list must not open Chrome')
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result)); return result
  }
  await call('browser_navigate', { url: `${fixture.url}/browser` })
  await call('browser_type', { target: '#name', text: 'Browser Use' })
  await call('browser_click', { target: 'button' })
  const snapshot = await call('browser_snapshot', {})
  const snapshotText = snapshot.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  // Playwright may persist large snapshots as artifacts; inspect either representation.
  const link = snapshotText.match(/\[Snapshot\]\(([^)]+)\)/)?.[1]
  const actualSnapshot = link ? await readFile(resolve(join(temporary, 'screenshots'), link), 'utf8') : snapshotText
  assert.match(actualSnapshot, /Saved Browser Use/)
  const screenshot = join(output, 'browser-form.png')
  const captured = join(temporary, 'screenshots/browser-form.png')
  await call('browser_take_screenshot', { filename: captured, type: 'png', scale: 'css' })
  const screenshotBytes = await readFile(captured)
  assert.ok(screenshotBytes.length > 100)
  await writeFile(screenshot, screenshotBytes)
  await client.close(); client = undefined

  // Render the installed UI and bridge it to the actual Backend, rather than demo data.
  const pkg = await runtime.getActivePackage(manifest.id)
  uiServer = createHttpServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const file = resolve(pkg.root, 'dist/ui', name === '/' ? 'index.html' : `.${name}`)
      assert.ok(file.startsWith(join(pkg.root, 'dist/ui') + '/'))
      response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(await readFile(file))
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => uiServer.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ executablePath: executable, headless: true })
  const page = await browser.newPage({ viewport: { width: 1120, height: 820 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('invokeBackend', invoke)
  await page.addInitScript(() => {
    window.mossApp = {
      app: { getInfo: async () => ({ appearance: { themeMode: 'light', cssThemeId: 'default' } }), getStatus: async () => ({ state: 'running' }), getInstallationState: async () => ({ installation: { enabled: true } }) },
      actions: { invoke: async (name, input) => ({ ok: true, result: await window.invokeBackend(name, input) }), cancel: async () => {} },
      events: { on: () => () => {} },
    }
  })
  await page.goto(`http://127.0.0.1:${uiServer.address().port}`)
  await expect(page.getByRole('status')).toContainText('工具已就绪')
  await page.screenshot({ path: join(output, 'installed-app.png'), fullPage: true })
  await page.locator('.browser-tools summary').click()
  await expect(page.getByRole('heading', { name: 'browser_click', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '连接设置' }).click()
  await page.getByLabel('输出目录').fill(join(temporary, 'Updated Output'))
  await page.getByRole('button', { name: '保存并连接' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('工具已就绪')
  assert.ok((await invoke('servers.list')).data.servers[0].config.args.includes(join(temporary, 'Updated Output')))
  assert.deepEqual(errors, [])

  await runtime.setAppEnabled(manifest.id, false)
  assert.equal(host.enabledServers()[serverName], undefined)
  assert.ok((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, 'disabling must preserve Chrome')
  const previousInspections = inspections
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => inspections > previousInspections && host.toolCatalog(manifest.id)[0]?.status === 'connected', 're-enabling must inspect again')
  assert.equal(registrations, 1)
  assert.ok(host.enabledServers()[serverName])
  assert.ok(host.toolCatalog(manifest.id)[0].tools.some(tool => tool.name === 'browser_click'))
  const report = { passed: true, platform: `${process.platform}-${process.arch}`, version: manifest.version, toolCount: tools.length,
    checks: ['archive installation without MCP App', 'Host startup, explicit inspection and App re-enable do not launch Chrome', 'MCP connection and tools/list do not launch Chrome', 'first automation request launches the managed browser', 'real MCP navigation/read/type/click/screenshot', 'empty PATH and npm cache with external network blocked', 'installed UI connected to real Backend and Host', 'configuration save and automatic reconnect', 'App disable/re-enable using existing lifecycle', 'browser preserved after disabling', 'dynamic App tool catalog'],
    testIsolation: 'The packaged App starts its managed browser only on the first automation request. Only the port, headless flag, output directory and MOSS_HOME are overridden for isolation.', screenshot }
  await writeFile(join(output, 'host.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS Browser Use ${manifest.version}: ${tools.length} tools, lazy managed browser launch, installed UI and App lifecycle`)
} finally {
  await client?.close().catch(() => {})
  await transport?.close().catch(() => {})
  await browser?.close()
  await runtime.shutdown()
  if (uiServer) { uiServer.closeAllConnections(); await new Promise(resolve => uiServer.close(resolve)) }
  try {
    const owned = await chromium.connectOverCDP(endpoint)
    const session = await owned.newBrowserCDPSession()
    await session.send('Browser.close').catch(() => {})
    await owned.close()
  } catch {}
  await fixture.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
