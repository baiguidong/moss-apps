// Real packaged Backend + Desktop Host + Chromium verification of both tool catalogs.
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { createServer as createHttpServer } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(root, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const requireFromCore = createRequire(join(core, 'ui/package.json'))
const tailwind = requireFromCore('@tailwindcss/postcss')
const temp = await mkdtemp(join(tmpdir(), 'moss-tool-ui-'))
process.env.MOSS_HOME = join(temp, 'home')
const fromCore = relative => import(pathToFileURL(join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { registerAppRuntimeIpc } = await fromCore('ui/src/apps/app-runtime-ipc.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const artifacts = join(repo, 'artifacts/moss.mcp/verification', manifest.version)
const runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
  credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
let settingsPage, inspections = 0, inspectionError = '', inspectionGate = null
const host = new AppMcpHost({ getRuntime: () => runtime,
  onCatalogChanged: () => { void settingsPage?.evaluate(() => window.dispatchEvent(new Event('fixture:apps-changed'))).catch(() => {}) },
  inspect: async (...args) => { inspections++; if (inspectionGate) await inspectionGate; if (inspectionError) throw new Error(inspectionError); return inspectDesktopMcpServer(...args) },
})
for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
const handlers = new Map()
registerAppRuntimeIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getRuntime: () => runtime, getMcpHost: () => host })
const servers = []
let browser
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts/moss.mcp', manifest.version, `moss.mcp-${manifest.version}.zip`))
  const instance = (await runtime.listInstances('moss.mcp'))[0]
  const invoke = async (method, input = {}) => runtime.invoke('moss.mcp', instance.id, method, input, { timeoutMs: 65_000 })
  const config = (await invoke('servers.list')).data.servers[0].config
  if (process.env.MOSS_TEST_CDP_ENDPOINT) {
    config.args[config.args.indexOf('--cdp-endpoint') + 1] = process.env.MOSS_TEST_CDP_ENDPOINT
    assert.equal((await invoke('servers.save', { name: 'playwright-cdp', previousName: 'playwright-cdp', enabled: true, config })).ok, true)
  }
  const pkg = await runtime.getActivePackage('moss.mcp')
  const appServer = createHttpServer(async (request, response) => {
    try {
      const filename = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(pkg.root, 'dist/ui', filename === '/' ? 'index.html' : '.' + filename);
      assert.ok(file.startsWith(join(pkg.root, 'dist/ui') + '/'));
      response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
  servers.push({ close: () => new Promise(resolve => appServer.close(resolve)) });
  const settingsServer = await createServer({ root: join(core, 'ui'), configFile: join(core, 'ui/vite.config.ts'),
    css: { postcss: { plugins: [tailwind({ base: join(core, 'ui') })] } },
    cacheDir: join(temp, 'settings-cache'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } })
  servers.push(settingsServer); await settingsServer.listen()
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1120, height: 780 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('invokeBackend', invoke)
  await page.addInitScript(({ instanceId }) => {
    window.mossApp = {
      app: { getInfo: async () => ({ appearance: { themeMode: 'light', cssThemeId: 'default' } }), getInstallationState: async () => ({ installation: { enabled: true } }) },
      instances: { list: async () => [{ id: instanceId }], getStatus: async () => ({ state: 'running' }) },
      actions: { invoke: (_id, method, input) => window.invokeBackend(method, input), cancel: async () => {} },
      events: { on: () => () => {} },
    }
  }, { instanceId: instance.id })
  await page.goto(`http://127.0.0.1:${appServer.address().port}`)
  await expect(page.getByRole('heading', { name: 'browser_click', exact: true })).toBeVisible({ timeout: 60_000 })
  const toolCount = host.toolCatalog('moss.mcp')[0].tools.length
  assert.equal(toolCount, 25)
  await expect(page.locator('.tool-row')).toHaveCount(toolCount)
  assert.equal(inspections, 1, 'first opening discovers once without clicking inspect')
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, 'app-tools.png'), fullPage: true })
  await page.close()
  host.checks.clear()
  settingsPage = await browser.newPage({ viewport: { width: 1120, height: 780 } })
  settingsPage.on('pageerror', error => errors.push(error.message))
  await settingsPage.exposeFunction('listAppsFixture', () => [{ id: 'moss.mcp', name: 'moss.mcp', displayName: 'MCP', enabled: true, agentTools: [], mcpServices: host.toolCatalog('moss.mcp') }])
  await settingsPage.exposeFunction('inspectToolsFixture', input => handlers.get('app:inspect-mcp-tools')({}, input))
  await settingsPage.addInitScript(() => {
    window.agentDesktop = {
      listApps: () => window.listAppsFixture(), inspectAppMcpTools: input => window.inspectToolsFixture(input),
      onAppsChanged: callback => { window.addEventListener('fixture:apps-changed', callback); return () => window.removeEventListener('fixture:apps-changed', callback) },
    }
  })
  await settingsPage.goto(`http://127.0.0.1:${settingsServer.httpServer.address().port}/tests/fixtures/app-tools.html`)
  const table = settingsPage.getByRole('table', { name: 'App 提供的工具' })
  await expect(table.getByRole('cell', { name: 'browser_click', exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(table.locator('tbody tr')).toHaveCount(toolCount)
  await expect(table).toHaveCSS('table-layout', 'fixed')
  assert.equal(inspections, 2, 'Settings discovers without opening App or clicking inspect')
  await settingsPage.screenshot({ path: join(artifacts, 'settings-tools.png'), fullPage: true })
  await invoke('servers.set-enabled', { name: 'playwright-cdp', enabled: false })
  await expect(table.getByRole('status')).toHaveText('服务已停用')
  assert.equal(inspections, 2)
  await invoke('servers.set-enabled', { name: 'playwright-cdp', enabled: true })
  await expect(table.getByRole('cell', { name: 'browser_click', exact: true })).toBeVisible({ timeout: 60_000 })
  assert.equal(inspections, 3)
  await invoke('servers.save', { name: 'playwright-cdp', previousName: 'playwright-cdp', enabled: true, config: { ...config, disabledTools: ['browser_close'] } })
  await expect(table.getByRole('row').filter({ has: settingsPage.getByRole('cell', { name: 'browser_close', exact: true }) })).toContainText('已排除', { timeout: 60_000 })
  assert.equal(inspections, 4)
  inspectionError = 'fixture: 服务暂时无法连接'
  await invoke('servers.save', { name: 'playwright-cdp', previousName: 'playwright-cdp', enabled: true, config })
  await expect(table.getByRole('alert')).toContainText(inspectionError)
  const failedCount = inspections
  await settingsPage.evaluate(() => window.dispatchEvent(new Event('fixture:apps-changed')))
  await expect(table.getByRole('status')).toHaveText('加载失败')
  assert.equal(inspections, failedCount, 'failed connections must not cause automatic retry loops')
  inspectionError = ''
  await table.getByRole('button', { name: '重新加载 playwright-cdp 工具' }).click()
  await expect(table.getByRole('cell', { name: 'browser_click', exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(table.getByRole('alert')).toHaveCount(0)
  assert.equal(inspections, failedCount + 1, 'manual retry must run once')
  let release
  inspectionGate = new Promise(resolve => { release = resolve })
  await invoke('servers.save', { name: 'playwright-cdp', previousName: 'playwright-cdp', enabled: true, config })
  await expect(table.getByRole('status')).toContainText('正在加载')
  await invoke('servers.set-enabled', { name: 'playwright-cdp', enabled: false })
  release(); inspectionGate = null
  await expect(table.getByRole('status')).toHaveText('服务已停用')
  await expect(table.getByRole('cell', { name: 'browser_click', exact: true })).toHaveCount(0)
  await expect(table.getByRole('alert')).toHaveCount(0)
  assert.deepEqual(errors, [])
  const report = { passed: true, toolCount, checks: ['packaged App first-open auto discovery', 'Desktop Settings dynamic discovery via IPC', 'enable and disable updates', 'configuration changes and excluded tools', 'failure without retry loops', 'manual retry', 'ignore late response after disable'], inspections }
  await writeFile(join(artifacts, 'tool-ui.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  settingsPage = undefined
  await browser?.close()
  await Promise.all(servers.map(server => server.close()))
  await runtime.shutdown()
  await rm(temp, { recursive: true, force: true })
}
