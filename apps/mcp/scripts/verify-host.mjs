import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(root, '../..'), core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const temporary = await mkdtemp(join(tmpdir(), 'moss-mcp-integration-'))
process.env.MOSS_HOME = join(temporary, 'moss-home')
const fromCore = relative => import(pathToFileURL(join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const fixture = await startMcpFixture()
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath, credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
let legacy = { version: 1, servers: {
  'test-http': { enabled: true, config: { type: 'http', url: `${fixture.url}/mcp`, headers: { Authorization: 'Bearer http-test-secret' } } },
  'test-local': { enabled: true, config: { type: 'stdio', command: process.execPath, args: [join(root, 'tests/stdio-fixture.mjs')], env: { FIXTURE_KEY: 'local-test-secret' } } },
  'test-sse': { enabled: false, config: { type: 'sse', url: `${fixture.url}/sse` } },
} }
let reloads = 0
const host = new AppMcpHost({ getRuntime: () => runtime, readLegacy: () => legacy, clearLegacy: () => { legacy = { version: 1, servers: {} } }, onChanged: () => { reloads++; return { resetSessionCount: 1 } }, inspect: inspectDesktopMcpServer,
  authenticate: () => { throw new Error('OAuth is not configured in this fixture') }, clearAuth: () => {} })
for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts/moss.mcp', manifest.version, `moss.mcp-${manifest.version}.zip`))
  const instance = (await runtime.listInstances('moss.mcp'))[0]
  // Persistent Backend initialization must provide the service before any UI action.
  const builtin = host.enabledServers()['playwright-cdp']
  assert.ok(builtin, 'built-in must register during installation/startup')
  assert.equal(builtin.command, process.execPath)
  assert.ok(builtin.args[0].endsWith('/playwright-cdp/cli.cjs') || builtin.args[0].endsWith('\\playwright-cdp\\cli.cjs'))
  const versions = JSON.parse(await readFile(join(dirname(builtin.args[0]), 'versions.json'), 'utf8'))
  assert.equal(versions['@playwright/mcp'], '0.0.83')
  assert.equal(builtin.args.at(-1), join(homedir(), '.moss/artifacts/playwright'))
  const invoke = async (method, input = {}) => {
    const result = await runtime.invoke('moss.mcp', instance.id, method, input, { timeoutMs: 65_000 })
    assert.equal(result.ok, true, result.error?.message)
    return result.data
  }
  let catalog = await invoke('servers.list')
  assert.equal(catalog.servers.length, 4); assert.deepEqual(legacy.servers, {})
  assert.equal(catalog.servers[0].config.headers.Authorization, '')
  const browserService = catalog.servers.find(server => server.name === 'playwright-cdp')
  assert.equal(browserService.builtin, true)
  assert.equal(browserService.config.args.at(-1), '~/.moss/artifacts/playwright')
  const inspectedBuiltin = await invoke('servers.inspect', { name: 'playwright-cdp' })
  const builtinCheck = inspectedBuiltin.servers.find(server => server.name === 'playwright-cdp').check
  assert.equal(builtinCheck.state, 'connected', builtinCheck.error)
  assert.ok(builtinCheck.tools.some(tool => tool.name === 'browser_click'))
  let cdpSmoke
  if (process.env.MOSS_TEST_CDP_ENDPOINT) {
    const { Client } = await fromCore('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')
    const { StdioClientTransport } = await fromCore('node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')
    const config = structuredClone(builtin)
    const outputDir = config.args.at(-1)
    // Exercise App-local expansion too, so the packaged service works with older Hosts.
    config.args[config.args.length - 1] = browserService.config.args.at(-1)
    config.args[config.args.indexOf('--cdp-endpoint') + 1] = process.env.MOSS_TEST_CDP_ENDPOINT
    const client = new Client({ name: 'moss-built-in-verification', version: manifest.version })
    const guard = join(temporary, 'offline-guard.cjs')
    await writeFile(guard, `const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const params = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof params[0] === 'object' ? params[0] : { port: params[0], host: typeof params[1] === 'string' ? params[1] : 'localhost' };
  if (options?.port && !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost')) throw new Error('Offline test blocked: ' + options.host);
  return connect.apply(this, args);
};
`)
    const transport = new StdioClientTransport({ ...config, env: { ...process.env, PATH: '', npm_config_offline: 'true', npm_config_cache: join(temporary, 'empty-npm-cache'), NODE_OPTIONS: '--require=' + JSON.stringify(guard) }, stderr: 'pipe' })
    let opened = false
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args })
      assert.ok(!result.isError, JSON.stringify(result))
      return result
    }
    const snapshotText = async result => {
      const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      const snapshotPath = text.match(/\[Snapshot\]\(([^)]+)\)/)?.[1]
      return snapshotPath ? readFile(join(outputDir, basename(snapshotPath)), 'utf8') : text
    }
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      assert.ok(tools.some(tool => tool.name === 'browser_click'))
      await call('browser_tabs', { action: 'new' }); opened = true
      const navigated = await call('browser_navigate', { url: `${fixture.url}/browser` })
      const snapshot = await snapshotText(navigated)
      const inputRef = snapshot.match(/textbox \"Name\" \[ref=([^\]]+)\]/)?.[1]
      const buttonRef = snapshot.match(/button \"Save\" \[ref=([^\]]+)\]/)?.[1]
      assert.ok(inputRef && buttonRef, snapshot)
      await call('browser_type', { target: inputRef, text: 'Moss', element: 'Name' })
      const filled = await call('browser_click', { target: buttonRef, element: 'Save' })
      assert.ok((await snapshotText(filled)).includes('Saved Moss'))
      const filename = `mcp-built-in-${Date.now()}.png`
      const screenshot = join(outputDir, filename)
      await call('browser_take_screenshot', { filename: screenshot, type: 'png', scale: 'css' })
      assert.ok((await readFile(screenshot)).length > 100)
      cdpSmoke = { offlineRuntime: true, emptyPathAndNpmCache: true, externalConnectionsBlocked: true, bundledVersions: versions, endpoint: process.env.MOSS_TEST_CDP_ENDPOINT, toolCount: tools.length, formResult: 'Saved Moss', screenshot }
      console.log(`PASS offline bundled Playwright CDP: ${tools.length} tools, real Chrome form and screenshot in expanded home directory`)
    } finally {
      if (opened) await call('browser_tabs', { action: 'close' }).catch(() => {})
      await client.close(); await transport.close()
    }
  }
  const occupiedConfig = structuredClone(browserService.config)
  occupiedConfig.args[occupiedConfig.args.indexOf('--cdp-endpoint') + 1] = fixture.url
  await invoke('servers.save', { name: 'playwright-cdp', previousName: 'playwright-cdp', enabled: false, config: occupiedConfig })
  const occupiedCheck = await invoke('servers.inspect', { name: 'playwright-cdp' })
  assert.match(occupiedCheck.servers.find(server => server.name === 'playwright-cdp').check.error, /端口.*占用/)
  const custom = { ...browserService.config, args: [...browserService.config.args, '--timeout-action', '7000'] }
  await invoke('servers.save', { name: 'playwright-cdp', previousName: 'playwright-cdp', enabled: false, config: custom })
  for (const name of ['test-http', 'test-local', 'test-sse']) {
    catalog = await invoke('servers.inspect', { name })
    const checked = catalog.servers.find(server => server.name === name)
    assert.equal(checked.check.state, 'connected')
    assert.deepEqual(checked.check.tools.map(tool => tool.name), name === 'test-local' ? ['read_workspace'] : ['search', 'lookup'])
    console.log(`PASS ${name}: real transport, credentials, tool discovery and cleanup`)
  }
  assert.equal(fixture.seen.filter(method => method === 'tools/list').length, 4)
  await invoke('servers.save', { name: 'unavailable', enabled: false, config: { type: 'http', url: `${fixture.url}/unavailable` } })
  const failed = await invoke('servers.inspect', { name: 'unavailable' })
  assert.equal(failed.servers.find(server => server.name === 'unavailable').check.state, 'failed')
  await invoke('servers.remove', { name: 'unavailable' })
  await invoke('servers.set-enabled', { name: 'test-http', enabled: false })
  assert.equal(host.enabledServers()['test-http'], undefined)
  await runtime.setAppEnabled('moss.mcp', false)
  assert.deepEqual(host.enabledServers(), {})
  await runtime.setAppEnabled('moss.mcp', true)
  await host.refresh()
  assert.deepEqual(Object.keys(host.enabledServers()), ['test-local'])
  catalog = await invoke('servers.list')
  const preserved = catalog.servers.filter(server => server.name === 'playwright-cdp')
  assert.equal(preserved.length, 1)
  assert.equal(preserved[0].enabled, false)
  assert.deepEqual(preserved[0].config, custom)
  await invoke('servers.remove', { name: 'test-local' })
  assert.deepEqual(host.enabledServers(), {})
  const vault = await readFile(join(process.env.MOSS_HOME, 'credentials/app-secrets.json'), 'utf8')
  assert.ok(!vault.includes('http-test-secret') && !vault.includes('local-test-secret'))
  const report = { passed: true, transports: ['http', 'stdio', 'sse'], checks: ['archive installation', 'built-in registration before UI', 'portable home paths', 'preserved built-in configuration and disabled state after restart', 'real backend to Host IPC', 'legacy migration', 'masked and encrypted credentials', 'paginated tool discovery', 'connection failure status', 'service and App lifecycle'], cdpSmoke, reloads }
  const reportDir = join(repo, 'artifacts/moss.mcp/verification', manifest.version)
  await mkdir(reportDir, { recursive: true }); await writeFile(join(reportDir, 'host.json'), JSON.stringify(report, null, 2))
  console.log('PASS real Core runtime: package, migration, secret storage, service/App lifecycle')
} finally { await runtime.shutdown(); await fixture.close(); await rm(temporary, { recursive: true, force: true }) }
