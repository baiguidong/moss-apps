import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const appsRoot = fileURLToPath(new URL('../', import.meta.url))
const coreRoot = path.resolve(process.env.MOSS_CORE_ROOT || path.join(appsRoot, 'vendor/moss-core'))
const { AppRuntimeHost, defaultInstanceId, writePackageChecksums } = await import(pathToFileURL(path.join(coreRoot, 'packages/app-runtime/src/index.mjs')))
const { createAppSessionStorage } = await import(pathToFileURL(path.join(coreRoot, 'ui/src/apps/app-session-storage.mjs')))
const { createAppArtifactUrls, createAppArtifactProtocolDefinition } = await import(pathToFileURL(path.join(coreRoot, 'ui/src/apps/app-artifacts.mjs')))
const { resolveAppResourceFile } = await import(pathToFileURL(path.join(coreRoot, 'ui/src/apps/app-resources.mjs')))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function fixture({ pdf = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'creation-session-integration-')))
  const source = path.join(root, 'source'), workspace = path.join(root, 'workspace'), privateRoot = path.join(root, 'host')
  await fs.mkdir(source); await fs.mkdir(workspace)
  const appId = 'test.creation', instanceId = defaultInstanceId(appId)
  const sessions = new Map(['session-a', 'session-b'].map(id => [id, { id, workspace, appIds: [appId], agentMode: 'local' }]))
  let host
  const storage = createAppSessionStorage({ getSession: id => sessions.get(id), getSessions: () => [...sessions.values()], getRuntime: () => host })
  const artifacts = createAppArtifactUrls({ sessionStorage: storage })
  const manifest = { schemaVersion: 2, id: appId, displayName: 'Creation', category: 'knowledge', version: '1.0.0', hostApi: '^3.23.0', permissions: [],
    host: { protocols: ['moss.artifacts/v1', 'moss.runtime/v1', 'moss.session-storage/v1'] },
    backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', storage: 'session',
      actions: ['workspace.get', 'tasks.start', 'tasks.get', 'tasks.cancel', 'artifacts.read', 'composer.resolve', 'composer.list', 'session.close'].map(name => ({ name, inputSchema: 'object.json', outputSchema: 'object.json', timeoutMs: 30000 })) },
    contributes: { resourceProviders: [{ id: 'files', title: 'Files', schemes: ['moss-test'], resolveAction: 'composer.resolve', listAction: 'composer.list' }] } }
  await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(source, 'object.json'), '{"type":"object"}')
  const runtimeSource = path.join(appsRoot, 'packages/engine-apps/src/runtime.mjs')
  await fs.writeFile(path.join(source, 'engine.mjs'), `
import fs from 'node:fs/promises'; import path from 'node:path';
import { TaskStore } from ${JSON.stringify(runtimeSource)};
export default { id:'test', spec:{version:'1'}, validate(){}, catalog(){return{}},
 async register(backend,ctx){ const store=new TaskStore(ctx.dataDir);
  backend.registerAction('composer.list',async()=>({items:await store.list()}));
  backend.registerAction('composer.resolve',async({uri})=>{const task=await store.get(new URL(uri).pathname.slice(1));return {kind:'file',path:task.artifacts[0].path,resourceUri:uri}});
 },
 async execute(input,ctx){
  if(input.wait)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,input.wait);ctx.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(ctx.signal.reason)},{once:true})});
  let version=1;if(input.parentId){const parent=await new TaskStore(ctx.dataDir).get(input.parentId);version=parent.result.version+1}
  const file=path.join(ctx.directory,'result.html');await fs.writeFile(file,input.text);const uri='moss-test://works/'+path.basename(ctx.directory);
  return {artifacts:[{name:'result.html',path:file,kind:'html'}],result:{version,resourceUri:uri,displayMarkdown:'[Result]('+uri+')',cacheDir:ctx.cacheDir,sessionId:ctx.sessionId}};
 }};
`)
  await fs.writeFile(path.join(source, 'entry.mjs'), `import {startBackend} from ${JSON.stringify(path.join(appsRoot, 'packages/engine-apps/src/backend.mjs'))};import engine from './engine.mjs';import {fileURLToPath} from 'node:url';startBackend(engine,fileURLToPath(new URL('./worker.mjs',import.meta.url)),{sessionScoped:true});`)
  await fs.writeFile(path.join(source, 'worker-entry.mjs'), `import {TaskStore,executeTask,waitForWorkerStart} from ${JSON.stringify(runtimeSource)};import engine from './engine.mjs';const signal=await waitForWorkerStart();const store=new TaskStore(process.argv[2]);await executeTask(engine,store,await store.get(process.argv[3]),signal);`)
  if (pdf) {
    manifest.backend.actions.push(...['files.import', 'files.export'].map(name => ({ name, inputSchema: 'object.json', outputSchema: 'object.json' })))
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify(manifest))
    await fs.writeFile(path.join(source, 'entry.mjs'), `
import {startApp} from ${JSON.stringify(path.join(appsRoot, 'packages/local-tasks/src/backend.mjs'))};
import {inspect,validate} from ${JSON.stringify(path.join(appsRoot, 'apps/pdf-tools/src/backend/engine.mjs'))};
import {fileURLToPath} from 'node:url';
startApp({sessionScoped:true,inspect,validate,worker:fileURLToPath(new URL('./worker.mjs',import.meta.url)),extraActions:{
 'tasks.get':(service,{id})=>service.state.tasks.find(task=>task.id===id),
 'composer.resolve':async(service,{uri})=>{const file=service.file(new URL(uri).pathname.slice(1));return {kind:'file',path:await service.filePath(file),resourceUri:uri}},
 'composer.list':service=>({items:service.state.files})
}});
`)
    await fs.writeFile(path.join(source, 'worker-entry.mjs'), `import ${JSON.stringify(path.join(appsRoot, 'apps/pdf-tools/src/backend/worker.mjs'))};`)
  }
  for (const [entry, output] of [['entry.mjs', 'main.mjs'], ['worker-entry.mjs', 'worker.mjs']]) {
    const build = spawnSync('bun', ['build', path.join(source, entry), '--target=node', '--format=esm', ...(pdf ? ['--external=@napi-rs/canvas', '--external=pdfjs-dist', '--external=tesseract.js', '--external=@tesseract.js-data/*'] : []), '--outfile=' + path.join(source, output)], { encoding: 'utf8' })
    assert.equal(build.status, 0, build.stderr)
  }
  await writePackageChecksums(source)
  async function start() {
    host = new AppRuntimeHost({ rootDir: privateRoot, nodeExecutable: process.execPath,
      prepareAppInvocation: args => storage.prepare(args), pendingSessionScopes: (app, instance) => storage.pendingScopes(app, instance),
      processOptions: { idleTimeoutMs: 30000, shutdownTimeoutMs: 10000 },
      hostCapabilityOptions: { protocols: [createAppArtifactProtocolDefinition(), { protocol: 'moss.session-storage/v1', methods: { 'scopes.pending': { surfaces: ['backend'], validateInput: v => v, validateOutput: v => v } } }] },
    })
    host.sessionStorage = storage
    host.registerHostHandler('moss.artifacts/v1', 'url.get', (input, context) => artifacts.url(input, context))
    host.registerHostHandler('moss.session-storage/v1', 'scopes.pending', (_input, context) => storage.pendingScopes(context.appId, context.instanceId))
    await host.initialize()
  }
  await start(); await host.installFromDirectory(source)
  const invoke = (sessionId, name, input = {}) => host.invoke(appId, instanceId, name, input, { invocation: { surface: 'tool', sessionId, workspace } })
  async function complete(sessionId, id) {
    for (let i = 0; i < 200; i++) {
      const task = await invoke(sessionId, 'tasks.get', { id })
      if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(task.status)) { assert.equal(task.status, 'succeeded', task.message); return task }
      await delay(25)
    }
    throw new Error('task did not finish')
  }
  return { root, sessions, storage, artifacts, appId, instanceId, workspace, invoke, complete, get host() { return host },
    restart: async () => { await host.shutdown(); await start() },
    close: async () => { await host?.shutdown(); await artifacts.close(); await fs.rm(root, { recursive: true, force: true }) } }
}

test('new creation tasks, edits, previews and restart use the owning session; deletion stops only its workers', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const a = await f.invoke('session-a', 'tasks.start', { text: 'A' })
    const b = await f.invoke('session-b', 'tasks.start', { text: 'B' })
    const first = await f.complete('session-a', a.id), second = await f.complete('session-b', b.id)
    assert.equal(first.sessionId, 'session-a')
    assert.ok(first.artifacts[0].path.startsWith(f.workspace + path.sep))
    assert.ok(first.result.cacheDir.startsWith(path.join(f.root, 'host', 'apps-data')))
    assert.equal(await fs.stat(path.join(first.result.cacheDir, 'jobs')).catch(() => null), null)
    assert.match(first.result.resourceUri, /\?session=session-a$/)
    assert.equal(await (await fetch(first.artifacts[0].url)).text(), 'A')
    const resolved = await resolveAppResourceFile(f.host, first.result.resourceUri, f.sessions.get('session-a'))
    assert.equal(resolved.path, first.artifacts[0].path)
    assert.equal((await f.invoke('session-b', 'workspace.get')).tasks.length, 1)
    await assert.rejects(f.invoke('session-b', 'tasks.get', { id: a.id }))
    const edit = await f.invoke('session-a', 'tasks.start', { text: 'A2', parentId: a.id })
    assert.equal((await f.complete('session-a', edit.id)).result.version, 2)
    assert.equal(await fs.readFile(first.artifacts[0].path, 'utf8'), 'A')
    await f.restart()
    assert.equal((await f.invoke('session-a', 'tasks.get', { id: edit.id })).result.version, 2)
    const slowA = await f.invoke('session-a', 'tasks.start', { text: 'late A', wait: 10000 })
    const slowB = await f.invoke('session-b', 'tasks.start', { text: 'late B', wait: 500 })
    await delay(100)
    f.sessions.get('session-a').deleted = true
    await f.storage.closeSession('session-a')
    await f.storage.removeSessionFiles('session-a')
    assert.equal((await f.complete('session-b', slowB.id)).status, 'succeeded')
    await delay(150)
    assert.equal(await fs.stat(path.dirname(path.dirname(first.artifacts[0].path))).catch(() => null), null)
    assert.equal(await fs.readFile(second.artifacts[0].path, 'utf8'), 'B')
    await assert.rejects(f.invoke('session-a', 'tasks.get', { id: slowA.id }), /关闭/)
  } finally { await f.close() }
})

test('pending session work is recovered after a Host restart without a private task store', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    await f.invoke('session-a', 'tasks.start', { text: 'running', wait: 10000 })
    const queued = await f.invoke('session-a', 'tasks.start', { text: 'recovered' })
    await f.restart()
    await f.host.restoreBackground()
    assert.equal((await f.complete('session-a', queued.id)).status, 'succeeded')
  } finally { await f.close() }
})

test('PDF imports, outputs, previews and state use session storage through LocalTasks', { timeout: 30000 }, async () => {
  const f = await fixture({ pdf: true })
  try {
    const { PDFDocument } = createRequire(path.join(appsRoot, 'apps/pdf-tools/package.json'))('pdf-lib')
    const document = await PDFDocument.create(); document.addPage([300, 400])
    const source = path.join(f.root, 'original.pdf'); await fs.writeFile(source, await document.save())
    const imported = await f.invoke('session-a', 'files.import', { paths: [source] })
    const fileId = imported.files[0].id
    const task = await f.invoke('session-a', 'tasks.start', { fileIds: [fileId], options: { pages: [{ fileId, page: 0, rotation: 90 }] } })
    await f.complete('session-a', task.id)
    const view = await f.invoke('session-a', 'workspace.get')
    assert.equal(view.files.length, 2)
    const output = view.files.find(file => file.role === 'output')
    const bytes = await (await fetch(output.url)).arrayBuffer()
    assert.equal((await PDFDocument.load(bytes)).getPage(0).getRotation().angle, 90)
    const scope = await f.storage.scope(f.appId, f.instanceId, 'session-a')
    const state = JSON.parse(await fs.readFile(path.join(scope.directory, 'workspace.json'), 'utf8'))
    assert.equal(state.tasks.length, 1)
    assert.equal((await f.invoke('session-b', 'workspace.get')).files.length, 0)
    await assert.rejects(f.invoke('session-b', 'tasks.start', { fileIds: [fileId], options: { pages: [{ fileId, page: 0 }] } }))
    await f.restart()
    assert.equal((await f.invoke('session-a', 'workspace.get')).files.length, 2)
    f.sessions.get('session-a').deleted = true
    await f.storage.closeSession('session-a'); await f.storage.removeSessionFiles('session-a')
    assert.equal(await fs.stat(scope.directory).catch(() => null), null)
    assert.equal((await PDFDocument.load(await fs.readFile(source))).getPage(0).getRotation().angle, 0)
  } finally { await f.close() }
})
