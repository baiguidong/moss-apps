const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const core = process.env.MOSS_CORE_ROOT
const archive = process.env.MOSS_ANYTHING_RAG_ARCHIVE
let runtime
let temporary
let picker = []
let closed = false
const windows = new Map()

async function cleanup() {
  if (closed) return
  closed = true
  for (const state of windows.values()) if (!state.window.isDestroyed()) state.window.destroy()
  await runtime?.shutdown()
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => {})
}

;(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-desktop-'))
  app.setPath('userData', path.join(temporary, 'profile'))
  await app.whenReady()
  const load = relative => import(pathToFileURL(path.join(core, relative)))
  const { createAppRuntime, installAppArchive } = await load('ui/src/apps/app-runtime.mjs')
  const { registerAppUiRequests } = await load('ui/src/apps/app-ui-requests.mjs')
  const local = await load('ui/src/apps/app-local-host.mjs')
  const appId = 'moss.anything-rag'
  const instanceData = path.join(temporary, 'moss', 'apps-data', appId, 'instances', `${appId}--default`)
  if (process.env.MOSS_RAG_DISABLE_NATIVE === '1') {
    await fs.mkdir(instanceData, { recursive: true })
    await fs.writeFile(path.join(instanceData, '.disable-native'), '1')
  }
  if (process.env.MOSS_RAG_MODEL_DIR) {
    await fs.mkdir(path.join(instanceData, 'models'), { recursive: true })
    await fs.cp(process.env.MOSS_RAG_MODEL_DIR, path.join(instanceData, 'models'), { recursive: true })
  }
  runtime = await createAppRuntime({
    mossHome: path.join(temporary, 'moss'),
    nodeExecutable: process.env.MOSS_TEST_NODE || process.execPath,
    hostProtocols: [local.createLocalFilesProtocolDefinition(), local.createRuntimesProtocolDefinition()],
    hostHandlers: local.createLocalAppHostHandlers({
      dialog: { showOpenDialog: async () => ({ canceled: !picker.length, filePaths: picker }) },
      shell: { openPath: async () => '', showItemInFolder: () => {} },
      getManagedRuntimeStatus: () => ({ node: { installed: true, path: process.env.MOSS_TEST_NODE || process.execPath } }),
    }),
    onEvent: event => {
      for (const state of windows.values()) {
        if (state.id !== event.appId || state.window.isDestroyed()) continue
        state.window.webContents.send('app-ui:event:runtime', event)
        if (event.type === 'backend-event') state.window.webContents.send(`app-ui:event:${event.name}`, event.data)
      }
    },
  })
  await installAppArchive(runtime, archive)
  const stateFor = sender => {
    const state = windows.get(sender.id)
    if (!state) throw new Error('Unknown App renderer')
    return { ...state, runtime }
  }
  registerAppUiRequests({ ipc: ipcMain, getState: stateFor })
  ipcMain.handle('app-ui:get-info', event => ({ id: stateFor(event.sender).id, appearance: { themeMode: 'light', cssThemeId: 'default' } }))
  ipcMain.handle('app-ui:get-installation-state', event => runtime.getApp(stateFor(event.sender).id))
  ipcMain.handle('app-ui:get-status', event => runtime.getApp(stateFor(event.sender).id))
  ipcMain.handle('app-ui:instances:list', event => runtime.listInstances(stateFor(event.sender).id))
  ipcMain.handle('app-ui:instances:get-status', (event, { instanceId }) => runtime.getInstanceStatus(stateFor(event.sender).id, instanceId))

  const pkg = await runtime.getActivePackage(appId)
  const window = new BrowserWindow({
    width: 1260,
    height: 820,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(core, 'ui/src/apps/app-preload.mjs') },
  })
  windows.set(window.webContents.id, { id: appId, window })
  await window.loadFile(path.join(pkg.root, pkg.manifest.ui.entry))

  globalThis.anythingFixture = {
    temporary,
    setPicker: paths => { picker = paths },
    picker: () => picker,
    windowId: () => window.id,
    invoke: (name, input = {}) => runtime.invoke(appId, `${appId}--default`, name, input, { timeoutMs: 300000 }),
    runtime,
    cleanup,
  }
  console.log('Anything RAG desktop fixture ready')
})().catch(async error => {
  console.error(error)
  await cleanup()
  app.exit(1)
})

app.on('before-quit', () => void cleanup())
app.on('window-all-closed', () => {})
