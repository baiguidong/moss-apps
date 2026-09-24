// Isolated verification harness. Uses Core's real preload/runtime/CloudStorageHost;
// native picker responses are deterministic so the test never opens user files.
const { app, BrowserWindow, ipcMain } = require('electron')
const { readFileSync } = require('node:fs')
const { mkdtemp, copyFile, open, writeFile, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const { randomUUID, createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const core = process.env.MOSS_CORE_ROOT, deploy = process.env.MOSS_DRIVE_TEST_DEPLOY
let temporary, runtime, host, window, appContents, dispatcher, token, folder, api
let source, destination, picker = [], cancelSave = false, savePickCount = 0, closed = false, deleteRequests = 0
const testFolders = new Set()
const checks = [], events = []
const env = Object.fromEntries(readFileSync(join(deploy, '.env'), 'utf8').split('\n').filter(line => line && !line.startsWith('#')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const base = `https://127.0.0.1:${env.MOSS_HTTPS_PORT}`

async function cleanup() {
  if (closed) return
  closed = true
  try {
    await host?.close()
    await runtime?.shutdown()
    if (folder && api) {
      // Unfinished uploads reserve children that files.list does not return.
      // Only recover/cancel sessions owned by this run's tracked tasks and folder.
      for (const task of host?.tasks.values() || []) {
        if (task.direction !== 'upload' || !testFolders.has(task.parentId) || task.uploadAttempted === false) continue
        try {
          const uploadId = task.uploadId || (await api(`/api/v1/cloud-storage/uploads?requestKey=${encodeURIComponent(task.id)}`)).id
          await api(`/api/v1/cloud-storage/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' })
        } catch (error) {
          if (!['UPLOAD_COMPLETED', 'UPLOAD_NOT_FOUND'].includes(error.code)) throw error
        }
      }
      // Children created by the UI are tracked and cleaned before their parents.
      for (const parentId of [...testFolders].reverse()) {
        let cursor
        do {
          const page = await api(`/api/v1/cloud-storage/files?parentId=${encodeURIComponent(parentId)}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
          for (const file of page.files) await api(`/api/v1/cloud-storage/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
          cursor = page.nextCursor
        } while (cursor)
        await api(`/api/v1/cloud-storage/files/${encodeURIComponent(parentId)}`, { method: 'DELETE' })
      }
    }
  } finally {
    await dispatcher?.close()
  }
}

;(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'moss-drive-desktop-'))
  app.setPath('userData', join(temporary, 'electron-profile'))
  await app.whenReady()
  const requireCore = createRequire(join(core, 'server/package.json'))
  const { Agent, fetch } = requireCore('undici')
  dispatcher = new Agent({ connect: { ca: readFileSync(join(deploy, 'tls/server.crt')) } })
  const request = (url, init = {}) => fetch(url, { ...init, dispatcher, redirect: 'error' })
  api = async (suffix, { method = 'GET', body } = {}) => {
    const response = await request(`${base}${suffix}`, {
      method, signal: AbortSignal.timeout(30_000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw Object.assign(new Error(`Test server returned HTTP ${response.status} (${data.error?.code || 'UNKNOWN'}) for ${method} ${suffix.split('?')[0]}`), { code: data.error?.code })
    }
    return response.json()
  }
  token = (await api('/api/v1/auth/token', { method: 'POST', body: { grant_type: 'password', username: env.MOSS_ADMIN_USERNAME, password: env.MOSS_ADMIN_PASSWORD } })).access_token
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  if ((await api('/api/v1/cloud-storage/status')).state !== 'ready') throw new Error('Local server cloud storage is not ready')
  folder = await api('/api/v1/cloud-storage/folders', { method: 'POST', body: { name: `drive-verification-${randomUUID()}` } })
  testFolders.add(folder.id)
  source = join(temporary, 'roundtrip.bin'); destination = join(temporary, 'download.bin')
  const fd = await open(source, 'w')
  try { await fd.truncate(35 * 1024 ** 2 + 101); await fd.write(Buffer.from('Moss Drive Desktop 0.1.0'), 0, 23, 1024 ** 2 + 13) } finally { await fd.close() }
  const cancelSource = join(temporary, 'cancel.bin'); await copyFile(source, cancelSource)
  const second = join(temporary, 'readme.txt'); await writeFile(second, 'Moss drive verification.\n')
  picker = [source, second]
  const { AppRuntimeHost } = await import(pathToFileURL(join(core, 'packages/app-runtime/src/host/index.mjs')))
  const { createCloudStorageProtocolDefinition } = await import(pathToFileURL(join(core, 'packages/app-runtime/src/cloud-storage/index.mjs')))
  const { installAppArchive } = await import(pathToFileURL(join(core, 'ui/src/apps/app-runtime.mjs')))
  const { CloudStorageHost } = await import(pathToFileURL(join(core, 'ui/src/apps/cloud-storage.mjs')))
  const sdk = await import(pathToFileURL(join(core, 'packages/app-sdk/src/index.mjs')))
  const settings = { remoteEnabled: true, remoteDirect: { serverUrl: base, credentialMode: 'api-key', apiKey: 'isolated-verification-binding' } }
  runtime = new AppRuntimeHost({ rootDir: join(temporary, 'moss'), nodeExecutable: process.env.MOSS_TEST_NODE, hostCapabilityOptions: { protocols: [createCloudStorageProtocolDefinition()] } })
  const makeHost = () => new CloudStorageHost({
    directory: join(temporary, 'transfers'), getSettings: () => settings,
    resolveConnection: async () => ({ serverUrl: base, orgId: claims.org_id, userId: claims.sub, authToken: token }),
    fetchImpl: async (url, init) => { if (/\/parts\/\d+$/.test(String(url))) await delay(150, undefined, { signal: init.signal }); return request(url, init) },
    pickFiles: async () => picker, pickDestination: async () => { savePickCount++; return cancelSave ? null : destination },
    authorizeApp: async (context, permission) => runtime.installations.get(context.appId)?.grants.includes(permission) === true,
    publish: (context, name, data) => { events.push(name); void runtime.publishHostEvent(context.appId, context.instanceId, 'moss.cloud-storage/v1', name, data).catch(() => {}) },
  })
  host = makeHost()
  for (const method of sdk.CLOUD_STORAGE_HOST_METHODS) runtime.registerHostHandler('moss.cloud-storage/v1', method, async (input, context) => {
    if (method === 'files.delete') deleteRequests++
    const result = await host.handle(method, input, context)
    if (method === 'folders.create' && testFolders.has(input.parentId)) testFolders.add(result.id)
    return result
  })
  await runtime.initialize()
  await installAppArchive(runtime, process.env.MOSS_DRIVE_ARCHIVE)
  checks.push('ZIP installed and persistent backend started in isolated Core runtime')
  const appId = 'moss.drive'
  const info = await runtime.getActivePackage(appId)
  ipcMain.handle('app-ui:get-info', () => ({ id: appId, appearance: { themeMode: 'light', cssThemeId: 'grid-theme' } }))
  ipcMain.handle('app-ui:get-installation-state', () => runtime.getApp(appId))
  ipcMain.handle('app-ui:instances:list', () => runtime.listInstances(appId))
  ipcMain.handle('app-ui:instances:get-status', (_event, { instanceId }) => runtime.getInstanceStatus(appId, instanceId))
  ipcMain.handle('app-ui:actions:invoke', (_event, { instanceId, name, input, requestId, timeoutMs }) => runtime.invoke(appId, instanceId, name, input, { requestId, timeoutMs }))
  ipcMain.handle('app-ui:actions:cancel', (_event, { instanceId, requestId }) => ({ canceled: runtime.cancel(appId, instanceId, requestId) }))
  runtime.events.on('event', event => {
    if (!appContents || appContents.isDestroyed() || event.appId !== appId) return
    appContents.send('app-ui:event:runtime', event)
    if (event.type === 'backend-event') appContents.send(`app-ui:event:${event.name}`, event.data)
  })
  window = new BrowserWindow({ width: 1120, height: 760, show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true,
    preload: join(__dirname, 'embedded-shell/preload.cjs'),
  } })
  window.webContents.on('will-attach-webview', (_event, preferences) => {
    preferences.preload = join(core, 'ui/src/apps/app-preload.mjs')
    preferences.contextIsolation = true; preferences.nodeIntegration = false; preferences.sandbox = false
  })
  window.webContents.on('did-attach-webview', (_event, guest) => { appContents = guest })
  ipcMain.handle('drive-test:open-embed', () => ({
    ok: true, embedId: randomUUID(), url: pathToFileURL(join(info.root, info.manifest.ui.entry)).href,
    preload: pathToFileURL(join(core, 'ui/src/apps/app-preload.mjs')).href,
    app: { id: appId, name: appId, displayName: info.manifest.displayName, description: info.manifest.description },
  }))
  ipcMain.handle('drive-test:close-embed', () => ({ ok: true }))
  globalThis.driveFixture = {
    folderName: folder.name, sourceName: 'roundtrip.bin', temporary, checks,
    setPicker: mode => { picker = mode === 'empty' ? [] : mode === 'one' ? [source] : mode === 'cancel' ? [cancelSource] : [source, second] },
    savePickCount: () => savePickCount,
    transferCount: () => host.tasks.size,
    deleteRequestCount: () => deleteRequests,
    remoteFiles: async () => (await api(`/api/v1/cloud-storage/files?parentId=${encodeURIComponent(folder.id)}&limit=200`)).files.map(file => ({ name: file.name, size: file.size, kind: file.kind })),
    quota: () => api('/api/v1/cloud-storage/quota'),
    setCancelSave: value => { cancelSave = value },
    waitWorkers: async () => { for (let i = 0; i < 100 && (host.running.size || host.cancellations.size); i++) await delay(50) },
    waitUploadInitialized: async name => { for (let i = 0; i < 200; i++) { if ([...host.tasks.values()].some(t => t.name === name && t.uploadId)) return; await delay(50) }; throw new Error('Upload did not initialize') },
    restartHost: async () => { await host.close(); host = makeHost() },
    disable: () => { settings.remoteEnabled = false; host.invalidate() },
    enable: () => { settings.remoteEnabled = true; host.invalidate() },
    hashes: async () => ({ source: createHash('sha256').update(await readFile(source)).digest('hex'), download: createHash('sha256').update(await readFile(destination)).digest('hex') }),
    report: () => ({ checks, progressEvents: events.filter(name => name === 'transfers.progress').length, changeEvents: events.filter(name => name === 'transfers.changed').length }),
    screenshot: async () => (await window.webContents.capturePage()).toPNG().toString('base64'),
    cleanup,
  }
  await window.loadFile(process.env.MOSS_DRIVE_TEST_SHELL)
})().catch(async error => {
  console.error(`Drive desktop fixture failed: ${error.message}`)
  try { await cleanup() } catch (failure) { console.error(`Fixture cleanup failed: ${failure.message}`) }
  if (temporary) await rm(temporary, { recursive: true, force: true })
  app.exit(1)
})
app.on('window-all-closed', () => {})
