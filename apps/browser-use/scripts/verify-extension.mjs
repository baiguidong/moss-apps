// Real extension handshake in a disposable existing Chrome profile. The fixture
// owns its token and browser; no customer token or browser setting is read.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const app = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(app, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const { Client } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')))
const { StdioClientTransport } = await import(pathToFileURL(join(core, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')))
const manifest = JSON.parse(await readFile(join(app, 'app.moss.json'), 'utf8'))
const packageRoot = join(repo, 'artifacts/moss.browser-use', manifest.version, 'package')
const extensionId = 'mmlmfjhmonkocbjadbfplnigmagldckm'
let extension = process.env.PLAYWRIGHT_TEST_EXTENSION_DIR
if (!extension) {
  const directory = join(homedir(), 'Library/Application Support/Google/Chrome/Default/Extensions', extensionId)
  const versions = (await readdir(directory)).sort()
  extension = join(directory, versions.at(-1))
}
const require = createRequire(import.meta.url)
const executable = await require(join(packageRoot, 'dist/playwright-cdp/managed.cjs')).installedExecutable()
assert.ok(executable)
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'moss-extension-fixture-')))
const profile = join(temporary, 'profile'), token = randomUUID(), fixture = await startMcpFixture(), clients = []
let context
try {
  const launch = () => chromium.launchPersistentContext(profile, { executablePath: executable, headless: false,
    // Match a normally opened browser. This Chrome build does not forward the
    // connect URL to an existing instance started with --enable-automation.
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  context = await launch()
  const setup = await context.newPage()
  await setup.goto(`chrome-extension://${extensionId}/status.html`)
  await setup.evaluate(value => localStorage.setItem('auth-token', value), token)
  // Flush the first-run unpacked extension's Preferences, then use an existing
  // profile as a customer would. No synthetic extension installation records.
  await context.close()
  context = await launch()
  await context.addCookies([{ name: 'existing_extension_login', value: 'logged-in', url: fixture.url }])
  const existing = await context.newPage(); await existing.goto(`${fixture.url}/browser`)
  async function connect() {
    const client = new Client({ name: 'extension-fixture', version: manifest.version })
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [join(packageRoot, 'dist/playwright-cdp/cli.cjs'), '--extension', '--executable-path', executable, '--user-data-dir', profile, '--profile-dir-name', 'Default', '--output-dir', temporary],
      env: { ...process.env, PLAYWRIGHT_MCP_EXTENSION_TOKEN: token }, stderr: 'pipe' })
    clients.push(client); await client.connect(transport)
    return client
  }
  const first = await connect()
  const tabs = await first.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })
  if (tabs.isError) {
    console.error('Fixture page URLs:', context.pages().map(page => page.url().replaceAll(token, '[fixture-token]')))
    for (const page of context.pages()) if (page.url().includes(`chrome-extension://${extensionId}/connect.html`)) {
      console.error('Extension status:', await page.locator('.status-banner').textContent())
    }
  }
  assert.ok(!tabs.isError, JSON.stringify(tabs))
  const navigated = await first.callTool({ name: 'browser_navigate', arguments: { url: `${fixture.url}/browser` } })
  assert.ok(!navigated.isError, JSON.stringify(navigated))
  const typed = await first.callTool({ name: 'browser_type', arguments: { target: '#name', text: 'Extension' } })
  assert.ok(!typed.isError, JSON.stringify(typed))
  const clicked = await first.callTool({ name: 'browser_click', arguments: { target: 'button' } })
  assert.ok(!clicked.isError, JSON.stringify(clicked))
  assert.ok((await context.cookies()).some(cookie => cookie.name === 'existing_extension_login' && cookie.value === 'logged-in'))
  await first.close()
  assert.equal(existing.isClosed(), false)
  const second = await connect()
  const reconnected = await second.callTool({ name: 'browser_tabs', arguments: { action: 'list' } })
  assert.ok(!reconnected.isError, JSON.stringify(reconnected))
  await second.close()
  assert.equal(existing.isClosed(), false)
  const report = { passed: true, checks: ['official extension protocol handshake', 'token-based connection without repeated prompts', 'existing profile cookie retained', 'navigation, typing and clicking through the extension', 'MCP disconnect preserves existing tabs', 'second client reconnects with the same token'], scope: 'Disposable Chrome for Testing profile with the official extension; customer browser credentials and settings untouched.' }
  const output = join(repo, 'artifacts/moss.browser-use/verification', manifest.version)
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'extension.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  await Promise.allSettled(clients.map(client => client.close()))
  await context?.close()
  await fixture.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
