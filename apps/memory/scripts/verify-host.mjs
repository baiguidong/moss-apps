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
const temporary = await mkdtemp(join(tmpdir(), 'moss-memory-app-'))
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
const serverName = 'moss_memory__memory'
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
  await waitFor(() => host.toolCatalog(manifest.id)[0]?.status === 'connected', 'Automatic MCP startup did not complete')
  assert.equal(registrations, 1); assert.equal(legacyReads, 0)
  assert.ok(!runtime.installations.get('moss.mcp'))
  const config = host.enabledServers()[serverName]
  assert.equal(config.command, process.execPath)
  const instance = (await runtime.listInstances(manifest.id))[0]
  const invoke = (method, input = {}) => runtime.invoke(manifest.id, instance.id, method, input, { timeoutMs: 65_000 })
  const ready = await invoke('servers.list')
  assert.equal(ready.ok, true); assert.equal(ready.data.preparation.state, 'ready')
  const file = ready.data.memoryFile
  assert.equal(config.args[1], file)
  assert.ok(file.startsWith(process.env.MOSS_HOME + '/'))
  assert.ok(!file.includes('/versions/'))
  const guard = join(temporary, 'offline.cjs')
  await writeFile(guard, "require('node:net').Socket.prototype.connect = function () { throw new Error('Network blocked by offline verification') }\n")
  const sessionOptions = { cwd: temporary, env: { NODE_OPTIONS: `--require=${JSON.stringify(guard)}`, npm_config_cache: join(temporary, 'empty-cache') } }
  sessions.push(await connect(config.args[0], config.args.slice(1), sessionOptions), await connect(config.args[0], config.args.slice(1), sessionOptions))
  const tools = (await sessions[0].client.listTools()).tools
  assert.equal(tools.length, 9)
  await Promise.all(Array.from({ length: 12 }, (_, i) => call(sessions[i % 2].client, 'create_entities', {
    entities: [{ name: `验证项目 ${i}`, entityType: '项目', observations: ['包内运行验证'] }],
  })))
  assert.equal((await call(sessions[0].client, 'read_graph', {})).entities.length, 12)
  await call(sessions[0].client, 'create_relations', { relations: [{ from: '验证项目 0', to: '验证项目 1', relationType: '依赖' }] })
  await call(sessions[0].client, 'add_observations', { observations: [{ entityName: '验证项目 0', contents: ['完成'] }] })
  const graph = await invoke('graph.read', {})
  assert.equal(graph.ok, true)
  assert.equal(graph.data.entities.length, 12)
  assert.ok(graph.data.entities.find(entity => entity.name === '验证项目 0').observations.includes('完成'))
  assert.deepEqual(graph.data.relations, [{ from: '验证项目 0', to: '验证项目 1', relationType: '依赖' }])
  await assert.rejects(() => invoke('graph.read', { path: '/etc/passwd' }))
  assert.equal((await call(sessions[0].client, 'search_nodes', { query: '完成' })).entities.length, 1)
  assert.equal((await call(sessions[0].client, 'open_nodes', { names: ['验证项目 0'] })).relations.length, 1)
  await call(sessions[0].client, 'delete_observations', { deletions: [{ entityName: '验证项目 0', observations: ['完成'] }] })
  await call(sessions[0].client, 'delete_relations', { relations: [{ from: '验证项目 0', to: '验证项目 1', relationType: '依赖' }] })
  await call(sessions[0].client, 'delete_entities', { entityNames: ['验证项目 11'] })
  await Promise.all(sessions.splice(0).map(session => session.close()))
  let saved = await readFile(file, 'utf8')

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
  await expect(page.getByRole('status')).toContainText('检查通过')
  const canvas = page.locator('[data-engine="antv-g6"]')
  await expect(canvas).toHaveAttribute('data-ready', 'true')
  await expect(canvas).toHaveAttribute('data-node-count', '11')
  await page.getByRole('button', { name: '选中记忆：验证项目 0', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: '记忆图谱', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '记忆详情' })).toContainText('包内运行验证')
  sessions.push(await connect(config.args[0], config.args.slice(1), sessionOptions))
  await call(sessions[0].client, 'create_entities', { entities: [{ name: '外部新增记忆', entityType: '验证', observations: ['通过真实 MCP 写入后刷新图谱'] }] })
  await page.getByRole('button', { name: '刷新记忆' }).click()
  await expect(canvas).toHaveAttribute('data-node-count', '12')
  await call(sessions[0].client, 'delete_entities', { entityNames: ['外部新增记忆'] })
  await page.getByRole('button', { name: '刷新记忆' }).click()
  await expect(canvas).toHaveAttribute('data-node-count', '11')
  await Promise.all(sessions.splice(0).map(session => session.close()))
  saved = await readFile(file, 'utf8')
  await page.screenshot({ path: join(output, 'installed-app.png'), fullPage: true })
  await page.getByRole('button', { name: '记忆设置' }).click()
  await page.getByLabel('不启用的工具').fill('delete_entities')
  await page.getByRole('button', { name: '保存并连接' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('检查通过')
  await page.locator('.memory-tools summary').click()
  await expect(page.getByRole('heading', { name: 'delete_entities已排除' })).toBeVisible()
  assert.deepEqual(errors, [])

  await runtime.setAppEnabled(manifest.id, false)
  assert.equal(host.enabledServers()[serverName], undefined)
  assert.equal(await readFile(file, 'utf8'), saved)
  const before = inspections
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => inspections > before && host.toolCatalog(manifest.id)[0]?.status === 'connected', 'Re-enable did not discover tools')
  assert.equal(registrations, 1)
  assert.deepEqual(host.enabledServers()[serverName].disabledTools, ['delete_entities'])
  assert.equal((await invoke('servers.list')).data.memoryFile, file)
  sessions.push(await connect(config.args[0], config.args.slice(1), sessionOptions))
  assert.equal((await call(sessions[0].client, 'read_graph', {})).entities.length, 11)
  const report = { passed: true, platform: `${process.platform}-${process.arch}`, version: manifest.version, toolCount: tools.length,
    checks: ['final ZIP installation without MCP App', 'automatic tool discovery before opening UI', 'offline execution with empty PATH/cache', 'all nine real memory tools', 'concurrent writes across MCP processes', 'installed UI with real Backend', 'G6 graph and real memory details', 'graph refresh after external MCP writes', 'fixed-path read-only graph action', 'tool exclusions', 'App disable/re-enable', 'persistent data preserved across restart'] }
  await writeFile(join(output, 'host.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS ${manifest.id}: ${tools.length} tools, concurrent memory, offline package, installed UI and lifecycle`)
} finally {
  await Promise.all(sessions.map(session => session.close().catch(() => {})))
  await browser?.close()
  await runtime.shutdown()
  if (uiServer) { uiServer.closeAllConnections(); await new Promise(resolve => uiServer.close(resolve)) }
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
