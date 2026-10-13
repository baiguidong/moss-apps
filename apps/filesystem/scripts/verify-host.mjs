// Install the final ZIP in an isolated, real Moss Host and exercise its tools.
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { chromium, expect } from '@playwright/test'
import { connect, call } from '../tests/mcp-client.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(root, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const temporary = await mkdtemp(join(tmpdir(), 'moss-filesystem-app-'))
process.env.MOSS_HOME = join(temporary, 'moss-home')
const fromCore = relative => import(pathToFileURL(join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const output = join(repo, 'artifacts', manifest.id, 'verification', manifest.version)
await mkdir(output, { recursive: true })
const runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
  credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
let inspections = 0, registrations = 0, legacyReads = 0
const host = new AppMcpHost({ getRuntime: () => runtime, readLegacy: () => { legacyReads++; return {} },
  inspect: (...args) => { inspections++; return inspectDesktopMcpServer(...args) } })
for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => {
  if (method === 'servers.save' && !input.previousName) registrations++
  return host.handle(method, input, context)
})
const serverName = 'moss_filesystem__filesystem'
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(message)
}
const sessions = []
let browser, uiServer
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts', manifest.id, manifest.version, `${manifest.id}-${manifest.version}.zip`))
  const instance = (await runtime.listInstances(manifest.id))[0]
  const invoke = (method, input = {}) => runtime.invoke(manifest.id, instance.id, method, input, { timeoutMs: 65_000 })
  await waitFor(async () => (await invoke('servers.list')).data.preparation.state === 'ready', 'Fresh App must register tools without public directories')
  assert.equal(registrations, 1); assert.equal(legacyReads, 0)
  assert.ok(!runtime.installations.get('moss.mcp'))
  const allowed = join(temporary, 'Allowed Directory')
  await mkdir(allowed)
  let config
  const guard = join(temporary, 'offline.cjs')
  await writeFile(guard, "require('node:net').Socket.prototype.connect = function () { throw new Error('Network blocked by offline verification') }\n")
  const sessionOptions = { cwd: temporary, env: { NODE_OPTIONS: `--require=${JSON.stringify(guard)}`, npm_config_cache: join(temporary, 'empty-cache') } }
  const workspace = join(temporary, 'Session workspace')
  await mkdir(workspace)
  const verifySessionDefault = async () => {
    const launch = host.enabledServers([manifest.id], workspace)[serverName]
    const connection = await connect(launch.args[0], launch.args.slice(1), { ...sessionOptions, env: { ...sessionOptions.env, ...launch.env } })
    try {
      await call(connection.client, 'write_file', { path: 'session.txt', content: 'session default' })
      assert.equal(await readFile(join(workspace, 'session.txt'), 'utf8'), 'session default')
      await assert.rejects(call(connection.client, 'list_directory', { path: allowed }), /Access denied/)
    } finally { await connection.close() }
    assert.deepEqual((await invoke('servers.list')).data.settings.directories, [])
  }
  await verifySessionDefault()
  const pkg = await runtime.getActivePackage(manifest.id)
  uiServer = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const path = resolve(pkg.root, 'dist/ui', name === '/' ? 'index.html' : `.${name}`)
      assert.ok(path.startsWith(join(pkg.root, 'dist/ui') + '/'))
      response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(await readFile(path))
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => uiServer.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true })
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
  await expect(page.getByRole('status')).toContainText('服务可用')
  await page.getByRole('button', { name: '添加公共目录' }).click()
  await page.getByLabel('公共目录（可选）').fill(allowed)
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await waitFor(() => host.toolCatalog(manifest.id)[0]?.status === 'connected', 'Saved scope did not automatically connect')
  await expect(page.getByRole('status')).toContainText('服务可用')
  assert.equal(registrations, 1)
  config = host.enabledServers()[serverName]
  assert.equal(config.command, process.execPath)
  sessions.push(await connect(config.args[0], config.args.slice(1), { ...sessionOptions, env: { ...sessionOptions.env, ...config.env } }))
  const client = sessions[0].client
  const tools = (await client.listTools()).tools
  assert.equal(tools.length, 14)
  const file = join(allowed, 'note.txt'), moved = join(allowed, 'moved.txt')
  await call(client, 'write_file', { path: file, content: 'first line\n' })
  assert.match(await call(client, 'read_text_file', { path: file }), /first line/)
  await call(client, 'edit_file', { path: file, edits: [{ oldText: 'first line', newText: 'updated' }], dryRun: true })
  assert.equal(await readFile(file, 'utf8'), 'first line\n')
  await call(client, 'edit_file', { path: file, edits: [{ oldText: 'first line', newText: 'updated' }] })
  await call(client, 'move_file', { source: file, destination: moved })
  assert.match(await call(client, 'search_files', { path: allowed, pattern: '*.txt' }), /moved.txt/)
  const outside = join(temporary, 'outside.txt'); await writeFile(outside, 'private fixture')
  await assert.rejects(call(client, 'read_text_file', { path: outside }), /Access denied/)
  await Promise.all(sessions.splice(0).map(session => session.close()))
  await page.screenshot({ path: join(output, 'installed-app.png'), fullPage: true })
  await page.getByRole('button', { name: '文件系统设置' }).click()
  await page.getByLabel('不启用的工具').fill('write_file')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('服务可用')
  await page.locator('.service-tools summary').click()
  await expect(page.getByRole('heading', { name: 'write_file已排除' })).toBeVisible()
  assert.deepEqual(errors, [])

  await runtime.setAppEnabled(manifest.id, false)
  assert.equal(host.enabledServers()[serverName], undefined)
  const before = inspections
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => inspections > before && host.toolCatalog(manifest.id)[0]?.status === 'connected', 'Re-enable did not discover tools')
  assert.equal(registrations, 1)
  assert.deepEqual(host.enabledServers()[serverName].disabledTools, ['write_file'])
  assert.equal((await invoke('servers.list')).data.settings.directories.length, 1)
  const cleared = await invoke('servers.save', { directories: [], disabledTools: [],  })
  assert.equal(cleared.ok, true)
  await waitFor(async () => (await invoke('servers.list')).data.preparation.state === 'ready', 'Cleared public scope must keep session tools ready')
  assert.ok(host.enabledServers()[serverName])
  assert.match(await readFile(moved, 'utf8'), /updated/)
  await runtime.setAppEnabled(manifest.id, false); await runtime.setAppEnabled(manifest.id, true)
  await waitFor(async () => (await invoke('servers.list')).data.preparation.state === 'ready', 'Empty public scope must remain ready after restart')
  assert.ok(host.enabledServers()[serverName])
  await verifySessionDefault()
  const report = { passed: true, platform: `${process.platform}-${process.arch}`, version: manifest.version, toolCount: tools.length,
    checks: ['final ZIP installation without MCP App', 'tools available without public directories', 'installed settings UI with real Backend', 'automatic connection after save', 'offline bundled MCP tool calls', 'path scope enforcement', 'tool exclusions', 'App disable/re-enable', 'clearing public scope preserves session tools after restart'] }
  await writeFile(join(output, 'host.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS ${manifest.id}: ${tools.length} tools, scope settings, offline package, installed UI and lifecycle`)
} finally {
  await Promise.all(sessions.map(session => session.close().catch(() => {})))
  await browser?.close()
  await runtime.shutdown()
  if (uiServer) { uiServer.closeAllConnections(); await new Promise(resolve => uiServer.close(resolve)) }
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
