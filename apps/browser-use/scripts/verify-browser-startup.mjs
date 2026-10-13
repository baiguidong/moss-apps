// Exercise the packaged MCP against an existing test browser. Only this harness
// owns/launches that browser; the App is forbidden from spawning Chrome.
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const appRoot = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(appRoot, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const { Client } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')))
const { StdioClientTransport } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')))
const manifest = JSON.parse(await readFile(join(appRoot, 'app.moss.json'), 'utf8'))
const executable = await createRequire(import.meta.url)(join(repo, 'artifacts/moss.browser-use', manifest.version, 'package/dist/playwright-cdp/managed.cjs')).installedExecutable()
assert.ok(executable, 'Prepare the pinned Chrome for Testing before running browser verification')
const temporary = await mkdtemp(join(tmpdir(), 'moss-browser-attachment-'))
const fixture = await startMcpFixture(), clients = [], transports = []
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port, endpoint = `http://127.0.0.1:${port}`
await new Promise(resolve => reservation.close(resolve))
let context
try {
  const guard = join(temporary, 'guard.cjs'), attempts = join(temporary, 'browser-spawn-attempts')
  await writeFile(guard, `const child = require('node:child_process');
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = child[method];
  child[method] = function (command, ...args) {
    if (/chrome|chromium/i.test(String(command))) {
      require('node:fs').appendFileSync(process.env.MOSS_TEST_BROWSER_ATTEMPTS, String(command) + '\\n');
      throw new Error('App must never launch a browser in this test');
    }
    return original.call(this, command, ...args);
  };
}
const net = require('node:net'), connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
  if (options?.port && !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost')) throw new Error('External network blocked');
  return connect.apply(this, args);
};\n`)
  const packaged = join(repo, 'artifacts/moss.browser-use', manifest.version, 'package/dist/playwright-cdp/cli.cjs')
  async function connect(args) {
    const client = new Client({ name: 'browser-attachment-test', version: manifest.version })
    const transport = new StdioClientTransport({ command: process.execPath, args: [packaged, '--output-dir', temporary, ...args],
      env: { ...process.env, PATH: '', npm_config_offline: 'true', npm_config_cache: join(temporary, 'empty-cache'),
        NODE_OPTIONS: '--require=' + JSON.stringify(guard), MOSS_TEST_BROWSER_ATTEMPTS: attempts,
        PWTEST_EXTENSION_USER_DATA_DIR: join(temporary, 'missing-extension-profile') }, stderr: 'pipe' })
    clients.push(client); transports.push(transport)
    await client.connect(transport)
    return client
  }
  await assert.rejects(connect(['--extension', '--browser', 'chrome']), /不会创建新的 Chrome 用户目录/)
  await assert.rejects(connect(['--extension', '--executable-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--user-data-dir', join(temporary, 'new-profile')]), /不会创建新的 Chrome 用户目录/)
  await assert.rejects(access(join(temporary, 'new-profile')), 'invalid custom profile must never be created')

  // The old local endpoint must fail without creating a profile or a browser.
  const closed = await connect(['--cdp-endpoint', endpoint, '--cdp-timeout', '700'])
  const tools = (await closed.listTools()).tools
  assert.ok(tools.some(tool => tool.name === 'browser_tabs'))
  const unavailable = await closed.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })
  assert.ok(unavailable.isError, 'a closed CDP endpoint must remain closed')
  await closed.close()
  await assert.rejects(fetch(`${endpoint}/json/version`))
  await assert.rejects(access(attempts), 'neither error path may attempt to start Chrome')

  // Explicitly create a disposable browser for positive attachment tests. This
  // is test setup, never a product fallback or the user's real Chrome profile.
  context = await chromium.launchPersistentContext(join(temporary, 'fixture-profile'), {
    executablePath: executable, headless: true, args: [`--remote-debugging-port=${port}`],
  })
  const existing = context.pages()[0]
  await existing.goto(`${fixture.url}/browser`)
  await context.addCookies([{ name: 'existing_session', value: 'signed-in-before-moss', url: fixture.url }])
  await existing.evaluate(() => localStorage.setItem('existing-preference', 'keep-me'))
  const socket = (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl
  const [first, second] = await Promise.all([connect(['--cdp-endpoint', endpoint]), connect(['--cdp-endpoint', endpoint])])
  const tabs = await first.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })
  assert.ok(!tabs.isError, JSON.stringify(tabs))
  assert.ok(!((await second.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })).isError))
  const call = async (name, args) => {
    const result = await first.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result)); return result
  }
  await call('browser_tabs', { action: 'new' })
  await call('browser_navigate', { url: `${fixture.url}/browser` })
  await call('browser_type', { target: '#name', text: 'Existing Chrome' })
  await call('browser_click', { target: 'button' })
  assert.ok((await context.cookies()).some(cookie => cookie.name === 'existing_session' && cookie.value === 'signed-in-before-moss'))
  await first.close(); await second.close()
  assert.equal((await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl, socket, 'MCP shutdown must preserve the browser')
  assert.equal(existing.isClosed(), false, 'MCP shutdown must preserve pre-existing tabs')
  assert.equal(await existing.evaluate(() => localStorage.getItem('existing-preference')), 'keep-me')
  const third = await connect(['--cdp-endpoint', endpoint])
  assert.ok(!((await third.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })).isError))
  await third.close()
  await assert.rejects(access(attempts), 'attachment, shutdown and reconnect must never launch Chrome')
  const report = { passed: true, toolCount: tools.length, checks: ['missing extension gives an actionable error without a new browser', 'custom executable cannot launch Chrome with a nonexistent profile', 'closed CDP fails without auto-start', 'concurrent attachment to an existing test browser', 'existing cookies and local storage preserved', 'real navigation, typing and click', 'MCP shutdown preserves the browser and pre-existing tabs', 'reconnect attaches to the same browser', 'empty PATH/npm cache and external network blocked'],
    limitation: 'Positive extension protocol and token reconnection are covered separately by verify-extension.mjs.' }
  const output = join(repo, 'artifacts/moss.browser-use/verification', manifest.version)
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'browser-startup.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS browser attachment: ${tools.length} tools; no auto-start, existing state, browser preserved`)
} finally {
  await Promise.allSettled(clients.map(client => client.close()))
  await Promise.allSettled(transports.map(transport => transport.close()))
  await context?.close()
  await fixture.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
