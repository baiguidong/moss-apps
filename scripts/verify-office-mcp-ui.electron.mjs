// Run with the Electron binary from a complete Moss Core checkout.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const requested = process.argv.indexOf('--app')
const selector = requested < 0 ? '' : process.argv[requested + 1]
const apps = ['markitdown', 'excel'].filter(name => !selector || [name, `moss.${name}`].includes(selector))
if (!selector || ['database', 'moss.database'].includes(selector)) {
  execFileSync('node', [path.join(repo, 'apps/database/scripts/verify-ui.mjs')], { timeout: 360000, stdio: 'inherit' })
  if (!apps.length) process.exit(0)
}
assert(apps.length && (requested < 0 || selector), 'Unknown --app selector')
const require = createRequire(path.join(core, 'ui/package.json'))
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { AppRuntimeHost } = await import(pathToFileURL(path.join(core, 'packages/app-runtime/src/host/index.mjs')).href)
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-office-ui-')))
const { MANAGED_RUNTIME_VERSIONS } = await import(pathToFileURL(path.join(core, 'ui/src/runtime/runtime-manifest.mjs')).href)
const existingRuntimes = process.env.MOSS_TEST_RUNTIME_HOME || path.join(os.homedir(), '.moss/runtimes')
process.env.MOSS_RUNTIME_HOME = path.join(temp, 'runtimes')
for (const name of ['node', 'python']) {
  const relative = path.join(name, 'versions', MANAGED_RUNTIME_VERSIONS[name])
  const source = path.join(existingRuntimes, relative), target = path.join(process.env.MOSS_RUNTIME_HOME, relative)
  if (await fs.stat(source).then(stat => stat.isDirectory(), () => false)) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
  }
}
process.env.MOSS_MCP_PYTHON_HOME ||= path.join(repo, '.cache/mcp-office-research/python')
process.env.npm_config_cache ||= path.join(repo, '.cache/mcp-office-research/npm')
process.env.MOSS_HOME = temp
process.env.MOSS_CONFIG_DIR = temp
process.env.MOSS_OPEN_DEVTOOLS = 'false'
app.setAppPath(path.join(core, 'ui'))
app.setPath('userData', path.join(temp, 'electron'))
app.on('window-all-closed', () => {})
let runtime, selectedArchive, mainWindow
const registered = AppRuntimeHost.prototype.registerInstalled
AppRuntimeHost.prototype.registerInstalled = function (...args) { runtime = this; return registered.apply(this, args) }
const handlers = new Map(), handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback) }
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedArchive] })
dialog.showMessageBox = async () => ({ response: 1 })
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {}
  if (mainWindow) return
  mainWindow = window
  window.webContents.once('did-finish-load', resolve)
}))
const waitFor = async (operation, label) => {
  const deadline = Date.now() + 310_000
  while (Date.now() < deadline) {
    if (await operation()) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out: ${label}`)
}
const timeout = setTimeout(() => { console.error('Office MCP UI verification timed out'); app.exit(1) }, 600_000)
let output
// Let Electron finish evaluating its entry module before waiting for app.ready.
async function run() {
try {
  await import(pathToFileURL(path.join(core, 'ui/src/main.mjs')).href)
  await ready
  const invoke = (name, input) => handlers.get(name)({ sender: mainWindow.webContents }, input)
  for (const name of apps) {
    const definition = JSON.parse(await fs.readFile(path.join(repo, 'mcp-apps', name, 'app.json'), 'utf8'))
    output = path.join(repo, 'artifacts', definition.id, definition.version)
    selectedArchive = path.join(output, `${definition.id}-${definition.version}.zip`)
    assert.equal((await invoke('app:install-archive')).ok, true)
    if (name === 'database') {
      const instance = await runtime.ensureDefaultInstance(definition.id)
      const config = structuredClone(definition.mcpServers.database)
      config.args[config.args.indexOf('--config') + 1] = path.join(temp, 'missing.toml')
      await runtime.requestHostCapability(definition.id, instance.id, 'moss.mcp/v1', 'servers.save', { name, previousName: name, enabled: true, config })
    }
    const before = new Set(BrowserWindow.getAllWindows())
    assert.equal((await invoke('app:launch', { name: definition.id })).ok, true)
    let view
    await waitFor(() => { view = BrowserWindow.getAllWindows().find(window => !before.has(window)); return view }, `${name} window`)
    const js = source => view.webContents.executeJavaScript(source)
    await waitFor(() => js(`document.querySelector('h1')?.textContent === ${JSON.stringify(definition.displayName)} && Boolean(document.querySelector('#settings')) && !document.querySelector('#settings').disabled`), `${name} ready`)
    assert.equal(await js("document.querySelector('.service-status').textContent"), '使用时连接', 'Opening settings should not start MCP')
    assert.equal(await js("document.querySelector('h1').textContent"), definition.displayName)
    const info = await js('window.mossApp.app.getInfo().then(info => ({ id: info.id, hasBackend: info.hasBackend }))')
    assert.deepEqual(info, { id: definition.id, hasBackend: false })
    assert((await js('document.body.innerText')).includes(definition.presentation.headline))
    await js("document.querySelector('#settings').click()")
    await waitFor(() => js("Boolean(document.querySelector('dialog[open]'))"), 'settings dialog')
    await js("document.querySelector('.connection-settings').open=true")
    const selector = `textarea[aria-label="${name} 连接配置"]`
    const original = JSON.parse(await js(`document.querySelector(${JSON.stringify(selector)}).value`))
    const config = structuredClone(original)
    if (name === 'excel') config.args[config.args.indexOf('--allow-dir') + 1] = temp
    if (name === 'database') {
      // An empty in-memory database is an explicit test fixture, never a product default.
      const template = await fs.readFile(path.join(repo, 'apps/database/resources/dbhub.example.txt'), 'utf8')
      const file = path.join(temp, 'ui-db.toml')
      await fs.writeFile(file, template)
      config.args[config.args.indexOf('--config') + 1] = file
      config.env.MOSS_DATABASE_DSN = 'sqlite://:memory:'
    }
    await js(`const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(JSON.stringify(config, null, 2))}); el.dispatchEvent(new Event('input',{bubbles:true}))`)
    await fs.writeFile(path.join(output, 'settings.png'), (await view.webContents.capturePage()).toPNG())
    await js("document.querySelector('button[type=submit]').click()")
    await waitFor(() => js("!document.querySelector('dialog') && document.querySelector('.service-status')?.textContent === '检查通过'"), `${name} saved and connected`)
    const count = await js("document.querySelectorAll('.tool-row').length")
    assert(count >= (name === 'markitdown' ? 1 : 2))
    await js("window.scrollTo(0,0); document.querySelector('.app-shell').scrollTop=0")
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme = '${theme}'`)
      await new Promise(resolve => setTimeout(resolve, 200))
      await fs.writeFile(path.join(output, `${theme}.png`), (await view.webContents.capturePage()).toPNG())
    }
    await js("document.documentElement.dataset.theme='light'")
    view.setSize(520, 900)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true)
    await fs.writeFile(path.join(output, 'narrow.png'), (await view.webContents.capturePage()).toPNG())
    await fs.writeFile(path.join(output, 'desktop-verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), fullDesktop: true, tools: count,
      checks: ['real Desktop ZIP install and launch', 'production shared UI and preload', 'App identity and settings navigation', 'connection configuration saved through UI', 'real upstream tool discovery', 'light/dark/narrow screenshots without horizontal overflow'] }, null, 2) + '\n')
    view.destroy()
    console.log(`PASS ${definition.id}: Desktop install, shared UI, configuration save, ${count} tools and responsive screenshots`)
  }
} catch (error) {
  console.error(error.stack)
  if (output) await fs.writeFile(path.join(output, 'desktop-verification.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2) + '\n')
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  await runtime?.shutdown().catch(() => {})
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  app.exit(process.exitCode || 0)
}
}
void run()
