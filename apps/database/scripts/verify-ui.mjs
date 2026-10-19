// Real packaged Backend + Core credential vault/MCP host + DBHub + browser UI.
// Requires a complete local Core checkout. All database and App data are temporary.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from '@playwright/test'

const appRoot = fileURLToPath(new URL('..', import.meta.url)), repo = path.resolve(appRoot, '../..')
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const definition = JSON.parse(await fs.readFile(path.join(appRoot, 'app.moss.json'), 'utf8'))
const output = path.join(repo, 'artifacts', definition.id, definition.version)
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-database-ui-')))
process.env.MOSS_HOME = root; process.env.MOSS_CONFIG_DIR = root
const fromCore = file => import(pathToFileURL(path.join(core, file)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const require = createRequire(path.join(core, 'package.json'))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
let runtime, browser, server, client
const errors = [], checks = []
const record = message => { checks.push(message); console.log(`PASS ${message}`) }
try {
  runtime = new AppRuntimeHost({ rootDir: root, nodeExecutable: process.execPath, credentialAdapter: new AppCredentialAdapter(root),
    hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  const host = new AppMcpHost({ getRuntime: () => runtime, inspect: inspectDesktopMcpServer })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize()
  await installAppArchive(runtime, path.join(output, `${definition.id}-${definition.version}.zip`))
  await runtime.registerInstalled(definition.id, definition.version)
  const instance = await runtime.ensureDefaultInstance(definition.id)
  await host.refresh()
  const invoke = (method, input = {}) => runtime.invoke(definition.id, instance.id, `connections.${method}`, input, { timeoutMs: 300000 })
  const initial = await invoke('list')
  assert.equal(initial.ok, true, JSON.stringify(initial))
  assert.deepEqual(initial.data.connections, [])
  assert.deepEqual(host.enabledServers([definition.id]), {})
  record('Fresh install has no configured or failing database service')
  const legacy = JSON.parse(await fs.readFile(path.join(appRoot, 'tests/fixtures/legacy-app.json'), 'utf8'))
  await runtime.requestHostCapability(definition.id, instance.id, MCP_PROTOCOL, 'servers.save', { name: 'database', enabled: true, config: legacy.mcpServers.database })
  const migrated = await invoke('list')
  assert.equal(migrated.data.connections[0].legacy, true)
  if (!(await fs.stat(path.join(os.homedir(), 'moss-database.toml')).catch(() => null))) assert.equal(migrated.data.connections[0].enabled, false)
  await invoke('remove', { id: 'database' })
  record('Legacy default can be managed in the UI and is suspended when its required file is missing')
  const file = path.join(root, '订单 #1.sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO orders VALUES (1,10),(2,20),(3,30)')
  db.close()
  const installed = await runtime.getActivePackage(definition.id)
  const uiRoot = path.join(installed.root, 'dist/ui')
  server = http.createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const target = path.resolve(uiRoot, '.' + (relative === '/' ? '/index.html' : relative))
      if (!target.startsWith(uiRoot + path.sep)) throw new Error('Invalid path')
      res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html')
      res.end(await fs.readFile(target))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1080, height: 820 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('invokeDatabase', async (action, input) => ({ ok: true, result: await runtime.invoke(definition.id, instance.id, action, input, { timeoutMs: 300000 }) }))
  await page.addInitScript(() => {
    window.mossApp = {
      app: { getInfo: async () => ({ id: 'moss.database', appearance: { themeMode: 'system', cssThemeId: 'default' } }) },
      actions: { invoke: (action, input) => window.invokeDatabase(action, input), cancel: async () => {} },
      events: { on: () => () => {} },
    }
  })
  const url = `http://127.0.0.1:${server.address().port}`
  await page.goto(url)
  await page.getByRole('heading', { name: '添加你的第一个数据库连接' }).waitFor()
  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  await page.getByLabel('连接名称').fill('订单查询')
  await page.getByLabel('数据库类型').selectOption('sqlite')
  await page.getByLabel('数据库文件路径').fill(path.join(root, 'missing.db'))
  await page.getByRole('button', { name: '保存并测试' }).click()
  await page.getByRole('alert').filter({ hasText: 'SQLite 文件不存在' }).waitFor()
  await assert.rejects(fs.stat(path.join(root, 'missing.db')))
  await page.getByLabel('数据库文件路径').fill(file)
  await page.getByLabel('最多返回行数').fill('2')
  await page.getByRole('button', { name: '保存并测试' }).click()
  await page.getByText('连接正常', { exact: true }).waitFor({ timeout: 300000 })
  record('UI creates and tests a real SQLite connection; missing files show actionable errors')
  const item = (await invoke('list')).data.connections[0]
  assert.equal(item.tools.length, 2)
  assert(item.tools.every(tool => tool.description.includes('订单查询')))
  assert.equal(Object.keys(host.enabledServers([])).length, 0)
  const config = Object.values(host.enabledServers([definition.id], root))[0]
  client = new Client({ name: 'database-test', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: config.command, args: config.args, env: { ...process.env, ...config.env }, stderr: 'pipe' })
  transport.stderr?.resume()
  await client.connect(transport)
  const text = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
  const rows = await client.callTool({ name: 'execute_sql', arguments: { sql: 'SELECT * FROM orders ORDER BY id' } })
  assert.equal(JSON.parse(text(rows)).data.statements[0].rows.length, 2)
  const write = await client.callTool({ name: 'execute_sql', arguments: { sql: 'DROP TABLE orders' } })
  assert.match(text(write), /read.?only|not allowed/i)
  record('Real query returns configured row limit and rejects writes; unselected App exposes no tools')
  await client.close(); client = null
  await runtime.restartInstance(definition.id, instance.id)
  await page.reload()
  await page.getByRole('heading', { name: '订单查询', exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑 订单查询', exact: true }).click()
  await page.getByLabel('连接名称').fill('订单统计')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '订单统计', exact: true }).waitFor()
  await page.getByLabel('启用 订单统计').click()
  await page.getByText('已停用', { exact: true }).waitFor()
  assert.deepEqual(host.enabledServers([definition.id]), {})
  await page.getByLabel('启用 订单统计').click()
  await page.getByText('待测试', { exact: true }).waitFor()
  record('Backend restart restores connections; UI edits and toggles update live MCP registry')
  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  await page.getByLabel('连接名称').fill('报表数据库')
  await page.getByLabel('数据库名称', { exact: true }).fill('reports')
  await page.getByLabel('用户名', { exact: true }).fill('reader')
  await page.getByLabel('密码', { exact: true }).fill('test:secret@中文')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '报表数据库', exact: true }).waitFor()
  const secretConfig = () => Object.values(host.enabledServers([definition.id])).find(config => Object.hasOwn(config.env, 'MOSS_DATABASE_PASSWORD'))
  assert.equal(secretConfig().env.MOSS_DATABASE_PASSWORD, encodeURIComponent('test:secret@中文'))
  await page.getByRole('button', { name: '编辑 报表数据库', exact: true }).click()
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '')
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    await page.screenshot({ path: path.join(output, `database-${theme}-editor.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '编辑 报表数据库', exact: true }).click()
  await page.getByLabel('主机地址').fill('127.0.0.1')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(secretConfig().env.MOSS_DATABASE_PASSWORD, encodeURIComponent('test:secret@中文'))
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    await page.screenshot({ path: path.join(output, `database-${theme}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'database-narrow.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', { name: '编辑 报表数据库', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'database-narrow-editor.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth), true)
  await page.keyboard.press('Escape')
  record('Multiple connections, masked password edits, light/dark themes and 390 px layout')
  await page.getByRole('button', { name: '删除 订单统计', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除连接', exact: true }).click()
  await page.getByRole('heading', { name: '订单统计', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await fs.stat(file)).isFile(), true)
  assert.equal((await invoke('list')).data.connections.length, 1)
  assert.equal(JSON.stringify(await invoke('list')).includes('test:secret'), false)
  assert.deepEqual(errors, [])
  record('Removal preserves actual database; catalog and UI never expose saved passwords')
  await fs.writeFile(path.join(output, 'database-verification.json'), JSON.stringify({ passed: true, checks, errors }, null, 2))
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  await page?.screenshot({ path: path.join(output, 'database-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await client?.close().catch(() => {})
  await browser?.close()
  await new Promise(resolve => server ? server.close(resolve) : resolve())
  await runtime?.shutdown().catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
}
