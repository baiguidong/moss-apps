// Actual Core container, preload, installer and runtime; isolated user profile.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { pathToFileURL } = require('node:url')
const core = process.env.MOSS_CORE_ROOT, appId = process.env.MOSS_TEST_APP
let mcpHost, releaseDiscovery
const discoveryGate = process.env.MOSS_TEST_DISCOVERY_GATE ? new Promise(resolve => { releaseDiscovery = resolve }) : Promise.resolve()
let directory, runtime, window, guest, instance, picks = [], calls = 0
let appearance = { themeMode: 'light', cssThemeId: 'default' }
;(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-local-desktop-')))
  app.setPath('userData', path.join(directory, 'electron-profile'))
  process.env.MOSS_HOME = path.join(directory, 'moss')
  process.env.MOSS_CONFIG_DIR = process.env.MOSS_HOME
  await app.whenReady()
  const fromCore = file => import(pathToFileURL(path.join(core, file)).href)
  const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
  const { installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
  const { registerAppUiRequests } = await fromCore('ui/src/apps/app-ui-requests.mjs')
  const { createLocalFilesProtocolDefinition, createLocalAppHostHandlers } = await fromCore('ui/src/apps/app-local-host.mjs')
  const { AppMcpHost, createMcpProtocolDefinition, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
  const { resolveAppSkills } = await fromCore('ui/src/apps/app-skills.mjs')
  const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
  runtime = new AppRuntimeHost({ rootDir: path.join(directory, 'moss'), nodeExecutable: process.env.MOSS_TEST_NODE,
    hostCapabilityOptions: { protocols: [createLocalFilesProtocolDefinition(), createMcpProtocolDefinition()] } })
  const handlers = createLocalAppHostHandlers({ dialog: { showOpenDialog: async () => ({ canceled: !picks.length, filePaths: picks.splice(0) }) }, shell: {}, BrowserWindow })
  for (const [method, handler] of Object.entries(handlers['moss.local-files/v1'])) runtime.registerHostHandler('moss.local-files/v1', method, handler)
  mcpHost = new AppMcpHost({ getRuntime: () => runtime, onChanged: () => ({}), readLegacy: async () => ({}),
    inspect: async (...args) => { await discoveryGate; return inspectDesktopMcpServer(...args) },
    onCatalogChanged: () => { if(window && !window.isDestroyed()) window.webContents.send('local-test:apps-changed') },
  })
  for (const method of MCP_METHODS) runtime.registerHostHandler('moss.mcp/v1', method, (input,ctx) => mcpHost.handle(method,input,ctx))
  await runtime.initialize()
  await installAppArchive(runtime, process.env.MOSS_TEST_ARCHIVE)
  await runtime.registerInstalled(appId, process.env.MOSS_TEST_VERSION || '0.1.0')
  instance = await runtime.ensureDefaultInstance(appId)
  await mcpHost.refresh()
  const info = await runtime.getActivePackage(appId)
  const uiFile = info.manifest.ui.builtin === 'mcp' ? path.join(core,'ui/dist/mcp-app/index.html') : path.join(info.root,info.manifest.ui.entry)
  const dataDir = runtime.appDataPath(runtime.dataDir, appId, 'instances', instance.id)
  ipcMain.handle('app-ui:get-info', () => ({ id: appId, displayName: info.manifest.displayName, hasBackend: Boolean(info.manifest.backend), appearance }))
  ipcMain.handle('app-ui:get-status', () => runtime.getInstanceStatus(appId, instance.id))
  ipcMain.handle('app-ui:get-installation-state', () => runtime.getApp(appId))
  ipcMain.handle('app-ui:instances:list', () => runtime.listInstances(appId))
  ipcMain.handle('app-ui:instances:get-status', () => runtime.getInstanceStatus(appId, instance.id))
  registerAppUiRequests({ ipc: ipcMain, getState: () => ({ id: appId, runtime }), beginRequest: () => { calls++; return () => {} } })
  runtime.events.on('event', event => { if (guest && !guest.isDestroyed() && event.appId === appId) guest.send('app-ui:event:runtime', event) })
  window = new BrowserWindow({ width: 1180, height: 880, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true, preload: path.join(__dirname, '../local-tasks-verify/preload.cjs') } })
  window.webContents.on('will-attach-webview', (_event, preferences) => {
    preferences.preload = path.join(core, 'ui/src/apps/app-preload.mjs'); preferences.contextIsolation = true; preferences.nodeIntegration = false; preferences.sandbox = false
  })
  window.webContents.on('did-attach-webview', (_event, contents) => { guest = contents })
  ipcMain.handle('local-test:open', () => ({ ok: true, embedId: appId, url: pathToFileURL(uiFile).href, preload: pathToFileURL(path.join(core, 'ui/src/apps/app-preload.mjs')).href, app: { id: appId, name: appId, displayName: info.manifest.displayName, description: info.manifest.description } }))
  ipcMain.handle('local-test:close', () => ({ ok: true }))
  ipcMain.handle('local-test:list-apps', () => [{id:appId,name:appId,title:info.manifest.displayName,displayName:info.manifest.displayName,description:info.manifest.description,enabled:true,icon:'',width:1180,height:880,resizable:true,createdAt:0,updatedAt:0,toolScope:info.manifest.toolScope,contributes:info.manifest.contributes,agentTools:info.manifest.contributes?.tools||[],mcpServices:typeof mcpHost !== 'undefined'?mcpHost?.toolCatalog(appId)||[]:[]}])
  ipcMain.handle('local-test:inspect-mcp', (_event,input) => mcpHost.inspectTools(input))

  globalThis.localTaskFixture = {
    directory, dataDir, installed: info.root,
    skills: selected => resolveAppSkills(runtime, selected ? [appId] : []),
    servers: async selected => { await mcpHost.refresh(); return mcpHost.enabledServers(selected ? [appId] : []) },
    catalog: () => mcpHost.toolCatalog(appId),
    releaseDiscovery: () => { releaseDiscovery?.(); return true },
    notifyCatalog: () => window.webContents.send('local-test:apps-changed'),
    calls: () => calls,
    pick: paths => { picks = paths },
    invoke: (action, input = {}) => runtime.invoke(appId, instance.id, action, input, { timeoutMs: 300000 }),
    invokeTool: (id, input = {}) => runtime.invokeToolContribution(`${appId}/${id}`, input, { timeoutMs: 300000 }),
    tools: selected => runtime.listContributions({ kinds: ['tools'], selectedAppIds: selected ? [appId] : [], loadSchemas: true }),
    restart: () => runtime.restartInstance(appId, instance.id),
    reload: () => new Promise(resolve => { guest.once('did-finish-load', resolve); guest.reload() }),
    enabled: async value => { await runtime.setAppEnabled(appId, value); await mcpHost.refresh() },
    click: ({ x, y }) => {
      window.focus(); guest.focus()
      guest.sendInputEvent({ type: 'mouseMove', x, y })
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    },
    drag: async ({from,to}) => {
      window.focus(); guest.focus()
      guest.sendInputEvent({type:'mouseMove',x:Math.round(from.x),y:Math.round(from.y)})
      guest.sendInputEvent({type:'mouseDown',x:Math.round(from.x),y:Math.round(from.y),button:'left',clickCount:1})
      for(let i=1;i<=12;i++){guest.sendInputEvent({type:'mouseMove',x:Math.round(from.x+(to.x-from.x)*i/12),y:Math.round(from.y+(to.y-from.y)*i/12),modifiers:['leftButtonDown']});await new Promise(resolve=>setTimeout(resolve,16))}
      guest.sendInputEvent({type:'mouseUp',x:Math.round(to.x),y:Math.round(to.y),button:'left',clickCount:1})
    },
    insertText: text => { window.focus(); guest.focus(); return guest.insertText(text) },
    theme: mode => { appearance = { ...appearance, themeMode: mode }; guest.send('app-ui:event:appearance', appearance) },
    resize: ({ width, height }) => window.setContentSize(width, height),
    screenshot: async () => (await window.webContents.capturePage()).toPNG().toString('base64'),
    cleanup: () => runtime.shutdown(),
  }
  await window.loadFile(process.env.MOSS_TEST_SHELL)
})().catch(async error => { console.error(error); await runtime?.shutdown().catch(() => {}); if (directory) await fs.rm(directory, { recursive: true, force: true }); app.exit(1) })
app.on('window-all-closed', () => {})
