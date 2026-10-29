// Install the real archive in an isolated Host; verify Core settings, lazy startup and MCP tools.
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer as createNetServer } from 'node:net'
import { chromium } from '@playwright/test'
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
let client, transport
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts/moss.browser-use', manifest.version, `moss.browser-use-${manifest.version}-${process.platform}-${process.arch}.zip`))
  await waitFor(() => Boolean(host.enabledServers()[serverName]), 'App did not register its service')
  assert.equal(inspections, 0, 'App startup must not inspect')
  assert.equal(registrations, 1)
  assert.equal(legacyReads, 0)
  assert.ok(!runtime.installations.get('moss.mcp'))
  const config = host.enabledServers()[serverName]
  assert.ok(config)
  const instance = (await runtime.listInstances(manifest.id))[0]
  const invoke = async (method, input = {}) => runtime.invoke(manifest.id, instance.id, method, input, { timeoutMs: 65_000 })
  const ready = await invoke('servers.list')
  assert.equal(ready.ok, true)
  assert.equal(ready.data.preparation.state, 'idle')
  assert.equal(ready.data.servers.length, 1)
  await invoke('servers.inspect', { name: 'playwright-cdp' })
  await waitFor(async () => (await invoke('servers.list')).data.preparation.state === 'ready', 'explicit inspection did not finish')
  const startupInspections = inspections
  await runtime.setAppEnabled(manifest.id, false)
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => Boolean(host.enabledServers()[serverName]), 'App re-enable did not register tools')
  assert.equal(inspections, startupInspections)
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
  // First use now unpacks the bundled browser lazily. Allow the OS archive
  // extractor while keeping npm/npx and other development tools off PATH.
  const bin = join(temporary, 'bin')
  await mkdir(bin)
  await symlink(process.platform === 'win32' ? join(process.env.SystemRoot, 'System32/tar.exe') : '/usr/bin/tar', join(bin, process.platform === 'win32' ? 'tar.exe' : 'tar'))
  transport = new StdioClientTransport({ ...config, env: { ...process.env, ...config.env, PATH: bin, npm_config_offline: 'true', npm_config_cache: join(temporary, 'empty-cache'), NODE_OPTIONS: '--require=' + JSON.stringify(guard) }, stderr: 'pipe' })
  client = new Client({ name: 'browser-app-verification', version: manifest.version })
  await client.connect(transport)
  const tools = (await client.listTools()).tools
  assert.ok(tools.some(tool => tool.name === 'browser_click'))
  await assert.rejects(fetch(`${endpoint}/json/version`), undefined, 'MCP connection and tools/list must not open Chrome')
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    if (result.isError) {
      const endpoint = JSON.stringify(result).match(/http:\/\/127\.0\.0\.1:\d+\/json\/version\//)?.[0]
      const detail = endpoint ? await fetch(endpoint).then(response => response.text()).catch(() => '') : ''
      assert.fail(JSON.stringify(result) + '\n' + detail)
    }
    return result
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

  // Exercise the Core declarative form endpoint against the real installed Backend.
  const { registerAppRuntimeIpc } = await fromCore('ui/src/apps/app-runtime-ipc.mjs')
  const handlers = new Map()
  registerAppRuntimeIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getRuntime: () => runtime })
  const settings = (operation, values) => handlers.get('app:settings-form')({}, { appId: manifest.id, version: manifest.version, settingId: 'connection', operation, values })
  const form = await settings('read')
  assert.equal(form.values.mode, 'managed')
  assert.equal((await runtime.getActivePackage(manifest.id)).manifest.ui, undefined)
  const beforeSave = inspections
  await settings('save', { ...form.values, outputDirectory: join(temporary, 'Updated Output') })
  assert.equal((await settings('read')).values.outputDirectory, join(temporary, 'Updated Output'))
  assert.equal(inspections, beforeSave, 'saving settings must not connect')

  await runtime.setAppEnabled(manifest.id, false)
  assert.equal(host.enabledServers()[serverName], undefined)
  assert.ok((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, 'disabling must preserve Chrome')
  const previousInspections = inspections
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => Boolean(host.enabledServers()[serverName]), 're-enabling must register the service')
  assert.equal(inspections, previousInspections)
  await invoke('servers.inspect', { name: 'playwright-cdp' })
  await waitFor(() => host.toolCatalog(manifest.id)[0]?.status === 'connected', 'explicit inspection must refresh the catalog')
  assert.equal(registrations, 1)
  assert.ok(host.enabledServers()[serverName])
  assert.ok(host.toolCatalog(manifest.id)[0].tools.some(tool => tool.name === 'browser_click'))
  const report = { passed: true, platform: `${process.platform}-${process.arch}`, version: manifest.version, toolCount: tools.length,
    checks: ['archive installation without MCP App', 'Host startup, explicit inspection and App re-enable do not launch Chrome', 'MCP connection and tools/list do not launch Chrome', 'first automation request launches the managed browser', 'real MCP navigation/read/type/click/screenshot', 'PATH contains only OS archive extractor; npm cache empty; external network blocked', 'Core form connected to real Backend and Host', 'configuration save without reconnect', 'App disable/re-enable using existing lifecycle', 'browser preserved after disabling', 'dynamic App tool catalog'],
    testIsolation: 'The packaged App starts its managed browser only on the first automation request. Only the port, headless flag, output directory and MOSS_HOME are overridden for isolation.', screenshot }
  await writeFile(join(output, 'host.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS Browser Use ${manifest.version}: ${tools.length} tools, lazy managed browser launch, Core settings and App lifecycle`)
} finally {
  await client?.close().catch(() => {})
  await transport?.close().catch(() => {})
  await runtime.shutdown()
  try {
    const owned = await chromium.connectOverCDP(endpoint)
    const session = await owned.newBrowserCDPSession()
    await session.send('Browser.close').catch(() => {})
    await owned.close()
  } catch {}
  await fixture.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
