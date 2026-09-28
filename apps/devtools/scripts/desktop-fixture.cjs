// Isolated integration with Core's real container, preload, ZIP installer and runtime.
const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')
const core = process.env.MOSS_CORE_ROOT, appId = 'moss.devtools'
let directory, runtime, window, guest
let appearance = { themeMode: 'light', cssThemeId: 'grid-theme' }
let calls = 0
;(async () => {
  directory = await mkdtemp(join(tmpdir(), 'moss-devtools-desktop-'))
  app.setPath('userData', join(directory, 'electron-profile'))
  await app.whenReady()
  const { AppRuntimeHost } = await import(pathToFileURL(join(core, 'packages/app-runtime/src/host/index.mjs')))
  const { installAppArchive } = await import(pathToFileURL(join(core, 'ui/src/apps/app-runtime.mjs')))
  runtime = new AppRuntimeHost({ rootDir: join(directory, 'moss') })
  await runtime.initialize()
  await installAppArchive(runtime, process.env.MOSS_DEVTOOLS_ARCHIVE)
  const info = await runtime.getActivePackage(appId)
  ipcMain.handle('app-ui:get-info', () => ({ id: appId, appearance }))
  ipcMain.handle('app-ui:get-installation-state', () => runtime.getApp(appId))
  ipcMain.handle('app-ui:instances:list', () => runtime.listInstances(appId))
  ipcMain.handle('app-ui:instances:get-status', (_event, { instanceId }) => runtime.getInstanceStatus(appId, instanceId))
  ipcMain.handle('app-ui:actions:invoke', (_event, { instanceId, name, input, requestId, timeoutMs }) => { calls++; return runtime.invoke(appId, instanceId, name, input, { requestId, timeoutMs }) })
  ipcMain.handle('app-ui:actions:cancel', (_event, { instanceId, requestId }) => ({ canceled: runtime.cancel(appId, instanceId, requestId) }))
  runtime.events.on('event', event => { if (guest && !guest.isDestroyed() && event.appId === appId) guest.send('app-ui:event:runtime', event) })
  window = new BrowserWindow({ width: 1080, height: 800, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true, preload: join(__dirname, 'embedded-shell/preload.cjs') } })
  window.webContents.on('will-attach-webview', (_event, preferences) => {
    preferences.preload = join(core, 'ui/src/apps/app-preload.mjs'); preferences.contextIsolation = true; preferences.nodeIntegration = false; preferences.sandbox = false
  })
  window.webContents.on('did-attach-webview', (_event, contents) => { guest = contents })
  ipcMain.handle('devtools-test:open-embed', () => ({ ok: true, embedId: randomUUID(), url: pathToFileURL(join(info.root, info.manifest.ui.entry)).href, preload: pathToFileURL(join(core, 'ui/src/apps/app-preload.mjs')).href, app: { id: appId, name: appId, displayName: info.manifest.displayName, description: info.manifest.description } }))
  ipcMain.handle('devtools-test:close-embed', () => ({ ok: true }))
  globalThis.devtoolsFixture = {
    directory, calls: () => calls,
    focus: () => { window.focus(); guest.focus() },
    insertText: text => { window.focus(); guest.focus(); return guest.insertText(text) },
    click: ({ x, y }) => {
      window.focus(); guest.focus()
      guest.sendInputEvent({ type: 'mouseMove', x, y })
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    },
    theme: value => { appearance = value; guest.send('app-ui:event:appearance', value) },
    enabled: value => runtime.setAppEnabled(appId, value),
    tools: () => runtime.listContributions({ kinds: ['tools'], loadSchemas: true }),
    invokeTool: (id, input) => runtime.invokeToolContribution(`${appId}/${id}`, input),
    screenshot: async () => (await window.webContents.capturePage()).toPNG().toString('base64'),
    cleanup: () => runtime.shutdown(),
  }
  await window.loadFile(process.env.MOSS_DEVTOOLS_SHELL)
})().catch(async error => {
  console.error(error)
  await runtime?.shutdown().catch(() => {})
  if (directory) await rm(directory, { recursive: true, force: true })
  app.exit(1)
})
app.on('window-all-closed', () => {})
