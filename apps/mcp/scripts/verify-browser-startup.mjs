import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const appRoot = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(appRoot, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const { Client } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')))
const { StdioClientTransport } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')))
const manifest = JSON.parse(await readFile(join(appRoot, 'app.moss.json'), 'utf8'))
const temporary = await mkdtemp(join(tmpdir(), 'moss-browser-startup-'))
const profile = join(temporary, 'Chrome Profile'), fixture = await startMcpFixture()
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${reservation.address().port}`
await new Promise(resolve => reservation.close(resolve))
const clients = [], transports = []
let browserEndpoint
async function closeBrowser() {
  if (!browserEndpoint) return
  const socket = new WebSocket(browserEndpoint)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })), { once: true })
    socket.addEventListener('close', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  }).catch(() => {})
  browserEndpoint = undefined
}
try {
  const guard = join(temporary, 'offline.cjs')
  await writeFile(guard, `const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
  if (options?.port && !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost')) throw new Error('External network blocked');
  return connect.apply(this, args);
};\n`)
  const config = { command: process.execPath, args: [join(appRoot, 'dist/playwright-cdp/cli.cjs'), '--cdp-endpoint', endpoint, '--user-data-dir', profile, '--output-dir', temporary, '--headless'],
    env: { ...process.env, PATH: '', npm_config_offline: 'true', npm_config_cache: join(temporary, 'empty-cache'), NODE_OPTIONS: '--require=' + JSON.stringify(guard) }, stderr: 'pipe' }
  async function connect() {
    const client = new Client({ name: 'cold-start-test', version: manifest.version }), transport = new StdioClientTransport(config)
    clients.push(client); transports.push(transport)
    await client.connect(transport)
    return client
  }
  await assert.rejects(fetch(`${endpoint}/json/version`))
  const [first, second] = await Promise.all([connect(), connect()])
  const version = await (await fetch(`${endpoint}/json/version`)).json()
  browserEndpoint = version.webSocketDebuggerUrl
  assert.ok(browserEndpoint)
  const initialTabs = await (await fetch(`${endpoint}/json/list`)).json()
  assert.equal(initialTabs.filter(tab => tab.type === 'page').length, 1, 'concurrent starts must not open duplicate Chrome windows')
  const tools = (await first.listTools()).tools
  assert.equal((await second.listTools()).tools.length, tools.length)
  const navigated = await first.callTool({ name: 'browser_navigate', arguments: { url: `${fixture.url}/browser` } })
  assert.ok(!navigated.isError, JSON.stringify(navigated))
  const input = await first.callTool({ name: 'browser_type', arguments: { target: '#name', text: 'Auto Chrome' } })
  assert.ok(!input.isError, JSON.stringify(input))
  const clicked = await first.callTool({ name: 'browser_click', arguments: { target: 'button' } })
  assert.ok(!clicked.isError, JSON.stringify(clicked))
  await first.close(); await second.close()
  assert.equal((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, browserEndpoint, 'MCP shutdown must leave the shared browser running')
  const third = await connect()
  assert.equal((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, browserEndpoint, 'next MCP startup must reuse Chrome')
  await third.close()
  const report = { passed: true, endpoint, toolCount: tools.length, checks: ['cold start with closed CDP port', 'Chrome launched with isolated persistent profile', 'two concurrent MCP processes share one Chrome', 'offline with empty PATH/npm cache', 'real browser navigation, typing and click', 'MCP shutdown leaves shared Chrome running', 'MCP restart reuses Chrome'] }
  const output = join(repo, 'artifacts/moss.mcp/verification', manifest.version)
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'browser-startup.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS automatic Chrome CDP: ${tools.length} tools; cold start, concurrent reuse, browser actions and MCP restart`)
} finally {
  await Promise.allSettled(clients.map(client => client.close()))
  await Promise.allSettled(transports.map(transport => transport.close()))
  if (!browserEndpoint) {
    try { browserEndpoint = (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl } catch {}
  }
  await closeBrowser()
  await fixture.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
