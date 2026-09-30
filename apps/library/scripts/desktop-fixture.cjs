const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')
const core = process.env.MOSS_CORE_ROOT
let temporary, runtime, window, guest, picker = [], closed = false
async function cleanup() { if (closed) return; closed = true; await runtime?.shutdown() }
;(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'moss-library-desktop-'))
  app.setPath('userData', join(temporary, 'profile'))
  await app.whenReady()
  const { createAppRuntime, installAppArchive } = await import(pathToFileURL(join(core, 'ui/src/apps/app-runtime.mjs')))
  const local = await import(pathToFileURL(join(core, 'ui/src/apps/app-local-host.mjs')))
  const opened = []
  runtime = await createAppRuntime({ mossHome: join(temporary, 'moss'), nodeExecutable: process.env.MOSS_TEST_NODE,
    hostProtocols: [local.createLocalFilesProtocolDefinition(), local.createRuntimesProtocolDefinition()],
    hostHandlers: local.createLocalAppHostHandlers({
      dialog: { showOpenDialog: async () => ({ canceled: !picker.length, filePaths: picker }) },
      shell: { openPath: async p => { opened.push(p); return '' }, showItemInFolder: p => opened.push(p) },
      getManagedRuntimeStatus: () => ({ python: { installed: true, path: process.env.MOSS_TEST_PYTHON || '/usr/bin/python3' } }),
    }),
  })
  await installAppArchive(runtime, process.env.MOSS_LIBRARY_ARCHIVE)
  const appId = 'moss.library', info = await runtime.getActivePackage(appId)
  const instance = (await runtime.listInstances(appId))[0]
  const contributions = await runtime.listContributions({ appId, kinds: ['tools'], loadSchemas: true })
  assert.deepEqual(contributions.tools.map(t => t.id.split('/').at(-1)).sort(), ['delete', 'list', 'read', 'search', 'write'])
  const tool = action => contributions.tools.find(item => item.action === action).id
  const invoke = (action, input = {}) => {
    if (['collections.create', 'collections.delete', 'documents.create', 'documents.update'].includes(action)) return runtime.invoke(appId, instance.id, action, input)
    if (action === 'collections.list') return runtime.invokeToolContribution(tool('library.list'), { kind: 'collections', ...input })
    if (action === 'sources.list') return runtime.invokeToolContribution(tool('library.list'), { kind: 'sources', ...input })
    if (action === 'documents.list') return runtime.invokeToolContribution(tool('library.list'), { kind: 'resources', ...input })
    return runtime.invokeToolContribution(tool(action === 'files.import' ? 'library.write' : action), input)
  }
  await assert.rejects(runtime.invokeToolContribution('moss.library/jobs-list', {}))
  const initial = (await invoke('collections.list')).data[0]
  const c = (await invoke('collections.create', { name: '验证资料' })).data
  const prepared = join(temporary, '工具写入.md')
  await writeFile(prepared, 'orchid alpha evidence')
  assert.equal((await invoke('files.import', { collectionId: c.id, paths: [prepared] })).data.writtenCount, 1)
  const doc = (await invoke('documents.list', { collectionId: c.id })).data[0]
  assert.equal(contributions.tools.find(t => t.id === 'moss.library/delete').effect, 'destructive')
  for (const input of [
    { operation: 'create', collectionId: c.id, title: 'raw', content: 'raw content' },
    { operation: 'update', resourceId: doc.id, revision: doc.revision, content: 'raw content' },
    { collectionId: c.id, paths: [temporary], filesOnly: false },
  ]) await assert.rejects(runtime.invokeToolContribution(tool('library.write'), input))
  const directoryWrite = (await invoke('files.import', { collectionId: c.id, paths: [temporary] })).data
  assert.equal(directoryWrite.writtenCount, 0)
  assert.equal(directoryWrite.failedCount, 1)
  assert.match(directoryWrite.failed[0].error, /只接受普通文件/)
  assert.equal((await invoke('documents.list', { collectionId: c.id })).data.length, 1)
  for (let i = 0; i < 100; i++) {
    if ((await invoke('documents.search', { query: 'orchid' })).data.length) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal((await invoke('documents.search', { query: 'orchid' })).data[0].resourceId, doc.id)
  assert.equal((await invoke('documents.search', { query: 'orchid', collectionIds: [initial.id] })).data.length, 0)
  const { resolveAppResourceFile } = await import(pathToFileURL(join(core, 'ui/src/apps/app-resources.mjs')))
  const exported = await resolveAppResourceFile(runtime, doc.uri)
  assert.equal(await readFile(exported.path, 'utf8'), 'orchid alpha evidence')
  await assert.rejects(invoke('documents.search', { query: 'orchid', projectId: 'unwanted' }))
  await runtime.restartInstance(appId, instance.id)
  assert.equal((await invoke('documents.read', { resourceId: doc.id })).data.title, '工具写入')
  assert.equal((await invoke('files.import', { collectionId: c.id, paths: [prepared] })).data.written[0].copied, false)
  await writeFile(prepared, 'blueberry prepared update')
  assert.equal((await invoke('files.import', { collectionId: c.id, paths: [prepared] })).data.written[0].copied, true)
  const reimported = (await invoke('documents.read', { resourceId: doc.id })).data
  assert.equal(reimported.content, 'blueberry prepared update')
  assert.notEqual(reimported.revision, doc.revision)
  await assert.rejects(invoke('documents.delete', { resourceId: doc.id, revision: doc.revision }), /版本已变化/)
  for (const revision of [undefined, '']) await assert.rejects(invoke('documents.delete', { resourceId: doc.id, revision }))
  const changes = await Promise.allSettled([
    invoke('documents.update', { resourceId: doc.id, revision: reimported.revision, content: 'first update' }),
    invoke('documents.update', { resourceId: doc.id, revision: reimported.revision, content: 'concurrent update' }),
  ])
  assert.equal(changes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(changes.filter(result => result.status === 'rejected').length, 1)
  const current = (await invoke('documents.read', { resourceId: doc.id })).data
  await invoke('documents.delete', { resourceId: doc.id, revision: current.revision })
  assert.equal(await readFile(prepared, 'utf8'), 'blueberry prepared update')
  const imported = join(temporary, 'AI-import.md'); await writeFile(imported, 'cinnamon file tool')
  assert.equal((await invoke('files.import', { collectionId: c.id, paths: [imported] })).data.writtenCount, 1)
  assert.equal((await invoke('documents.list', { collectionId: c.id })).data.length, 1)
  await invoke('collections.delete', { id: c.id })
  await runtime.setAppEnabled(appId, false)
  assert.equal((await runtime.listContributions({ appId, kinds: ['tools'] })).tools.length, 0)
  await assert.rejects(invoke('collections.list'))
  await runtime.setAppEnabled(appId, true)
  const source = join(temporary, '输入资料'); await mkdir(join(source, '产品'), { recursive: true })
  await writeFile(join(source, '产品', '检索指南.md'), '# 检索指南\n\n跨资料集搜索 orchid，支持中文知识检索。')
  picker = [source]
  ipcMain.handle('app-ui:get-info', () => ({ id: appId, appearance: { themeMode: 'light', cssThemeId: 'grid-theme' } }))
  ipcMain.handle('app-ui:get-installation-state', () => runtime.getApp(appId))
  ipcMain.handle('app-ui:instances:list', () => runtime.listInstances(appId))
  ipcMain.handle('app-ui:instances:get-status', (_event, { instanceId }) => runtime.getInstanceStatus(appId, instanceId))
  ipcMain.handle('app-ui:actions:invoke', (_event, { instanceId, name, input, requestId, timeoutMs }) => runtime.invoke(appId, instanceId, name, input, { requestId, timeoutMs }))
  ipcMain.handle('app-ui:actions:cancel', (_event, { instanceId, requestId }) => ({ canceled: runtime.cancel(appId, instanceId, requestId) }))
  runtime.events.on('event', event => {
    if (!guest || guest.isDestroyed() || event.appId !== appId) return
    guest.send('app-ui:event:runtime', event)
    if (event.type === 'backend-event') guest.send(`app-ui:event:${event.name}`, event.data)
  })
  window = new BrowserWindow({ width: 1160, height: 780, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true, preload: join(__dirname, 'embedded-shell/preload.cjs') } })
  window.webContents.on('will-attach-webview', (_event, preferences) => { preferences.preload = join(core, 'ui/src/apps/app-preload.mjs'); preferences.contextIsolation = true; preferences.nodeIntegration = false; preferences.sandbox = false })
  window.webContents.on('did-attach-webview', (_event, contents) => { guest = contents })
  ipcMain.handle('library-test:open-embed', () => ({ ok: true, embedId: randomUUID(), url: pathToFileURL(join(info.root, info.manifest.ui.entry)).href, preload: pathToFileURL(join(core, 'ui/src/apps/app-preload.mjs')).href, app: { id: appId, name: appId, displayName: info.manifest.displayName, description: info.manifest.description } }))
  ipcMain.handle('library-test:close-embed', () => ({ ok: true }))
  globalThis.libraryFixture = { temporary, cleanup, opened, invoke, source,
    screenshot: async () => (await window.webContents.capturePage()).toPNG().toString('base64'),
    tools: contributions.tools.map(t => ({ action: t.action, effect: t.effect })),
  }
  await window.loadFile(process.env.MOSS_LIBRARY_TEST_SHELL)
})().catch(async e => { console.error(e); await cleanup(); if (temporary) await rm(temporary, { recursive: true, force: true }); app.exit(1) })
app.on('window-all-closed', () => {})
