import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { AppBackendClient } from '@moss/app-sdk'
import { TaskStore } from './runtime.mjs'
import { WorkerQueue } from './queue.mjs'
import { sendArtifact } from './artifact-http.mjs'

const within = (root, file) => {
  const relative = path.relative(root, file)
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
async function mapLimited(items, limit, visit) {
  const result = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      result[index] = await visit(items[index], index)
    }
  }))
  return result
}

export function startBackend(engine, worker) {
  let store, queue, server, base, context, stopping, activationTask, activationError, ready = false, registrationError = '', catalog
  let hostArtifactUrls = false
  const signedUrls = new Map()
  let resolveActivation
  const activationReady = new Promise(resolve => { resolveActivation = resolve })
  const token = randomBytes(32).toString('hex')
  function shutdown() {
    return stopping ??= (async () => {
      try { await queue?.shutdown(); await activationTask?.catch(() => {}) }
      finally {
        server?.closeAllConnections()
        await new Promise(resolve => server ? server.close(resolve) : resolve())
        await engine.close?.()
      }
    })()
  }
  const backend = new AppBackendClient({
    onInitialize: async ctx => {
      context = ctx; store = new TaskStore(ctx.dataDir)
      hostArtifactUrls = ctx.protocols.includes('moss.artifacts/v1')
      if (!hostArtifactUrls) {
        server = http.createServer((req, res) => { serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(404); res.end() }) })
        await new Promise((resolve,reject) => { server.once('error', reject); server.listen(0,'127.0.0.1',resolve) })
        base = `http://127.0.0.1:${server.address().port}`
      }
      queue = new WorkerQueue({ store, worker, concurrency: engine.workerConcurrency ?? 1, maxQueued: engine.maxQueuedTasks,
        env: () => engine.workerEnv?.(context) || {},
        lease: ctx.protocols.includes('moss.runtime/v1')
          ? (operation, id, signal) => backend.host.request('moss.runtime/v1', `activity.${operation}`, { id }, { signal, timeoutMs: 10_000 }) : null,
        onChanged: () => { if (ready && !queue.closed) backend.emit('workspace.changed', {}) },
      })
      setImmediate(() => {
        activationTask = queue.restore({ start: false }).then(() => {
          if (!queue.closed) { ready = true; queue.pump() }
        }).catch(error => { activationError = error; registrationError = error.message }).finally(resolveActivation)
        if (engine.register) void engine.register(backend, ctx).catch(error => { registrationError = error.message })
      })
    },
    onShutdown: shutdown,
    onDisconnect: handler => {
      if (typeof process.send === 'function') process.once('disconnect', () => {
        void shutdown().catch(error => console.error(error)).finally(handler)
      })
    },
  })
  async function signedUrl(task, index) {
    const file = task.artifacts[index]
    if (typeof file.path !== 'string' || !path.isAbsolute(file.path)) throw new Error('结果路径无效')
    const [jobRoot, target, dataRoot] = await Promise.all([
      fs.realpath(store.directory(task.id)), fs.realpath(file.path), fs.realpath(context.dataDir),
    ])
    // Host URLs must only expose this task's own files, even when an engine
    // grants readRoots for its explicit read/export actions.
    const stat = await fs.stat(target)
    if (target === jobRoot || !within(jobRoot, target) || !stat.isFile()) {
      throw new Error('结果文件不在本次任务目录中')
    }
    const relative = path.relative(dataRoot, target)
    if (!relative || !within(dataRoot, target)) throw new Error('结果文件不在 App 数据目录中')
    const key = relative.split(path.sep).join('/')
    const cached = signedUrls.get(key)
    if (cached && Date.now() - cached.createdAt < 60 * 60_000) {
      signedUrls.delete(key); signedUrls.set(key, cached)
      return { url: await cached.promise, size: stat.size }
    }
    const promise = backend.host.request('moss.artifacts/v1', 'url.get', { relativePath: key }).then(result => result.url)
    signedUrls.delete(key)
    signedUrls.set(key, { promise, createdAt: Date.now() })
    if (signedUrls.size > 1024) signedUrls.delete(signedUrls.keys().next().value)
    promise.catch(() => { if (signedUrls.get(key)?.promise === promise) signedUrls.delete(key) })
    return { url: await promise, size: stat.size }
  }
  async function view(task, { urls = true } = {}) {
    if (hostArtifactUrls) {
      if (!urls) return { ...task, artifacts: task.artifacts.map(file => ({ ...file, url: '' })) }
      const artifacts = await mapLimited(task.artifacts, 8, async (file, index) => {
        try { return { ...file, ...await signedUrl(task, index) } }
        catch (error) { return { ...file, url: '', urlError: String(error?.message || error) } }
      })
      return { ...task, artifacts }
    }
    return { ...task, artifacts: task.artifacts.map((file, index) => ({ ...file, url: `${base}/${token}/${task.id}/${index}/` })) }
  }
  async function startTask(input, source = 'ui', signal) {
    await activationReady
    if (activationError) throw activationError
    return queue.start(input, source, async () => {
      await engine.validate(input)
      await engine.requireReady?.(context)
    }, signal)
  }
  const tasks = {
    startTask,
    getTask: id => store.get(id),
    cancelTask: async id => { await activationReady; return queue.cancel(id) },
  }
  async function artifact(id, index) {
    const task = await store.get(id), item = task.artifacts[index]
    if (!item || !Number.isInteger(index)) throw new Error('找不到结果文件')
    const target = await fs.realpath(item.path)
    const jobRoot = await fs.realpath(store.directory(id))
    let allowed = within(jobRoot, target)
    if (!allowed) {
      for (const root of task.readRoots || []) {
        const resolved = await fs.realpath(root).catch(() => null)
        if (resolved && within(resolved, target)) { allowed = true; break }
      }
    }
    if (!allowed) throw new Error('结果文件不在本次任务目录中')
    if (!(await fs.stat(target)).isFile()) throw new Error('结果不是文件')
    return { item, target }
  }
  async function serve(req, res) {
    if (req.headers.host !== new URL(base).host || !['GET','HEAD'].includes(req.method)) { res.writeHead(403); return res.end() }
    const parts = new URL(req.url, base).pathname.split('/')
    if (parts.length !== 5 || parts[1] !== token || !/^(0|[1-9]\d*)$/.test(parts[3])) { res.writeHead(404); return res.end() }
    // Trailing / is intentional so links cannot be confused with shell paths.
    if (parts[4] !== '') { res.writeHead(404); return res.end() }
    const { target } = await artifact(parts[2], Number(parts[3]))
    await sendArtifact(req, res, target)
  }
  backend.registerAction('workspace.get', async () => ({ tasks: await Promise.all((await store.list()).map(task => view(task, { urls: !hostArtifactUrls }))),
    artifactUrlsDeferred: hostArtifactUrls, engine: { id:engine.id, version:engine.spec.version }, registrationError }))
  backend.registerAction('catalog.get', async () => catalog ??= await engine.catalog({ dataDir: context.dataDir }))
  backend.registerAction('engine.prepare', async () => { catalog = await engine.catalog({ dataDir: context.dataDir, prepare: true }); if (engine.register) { await engine.register(backend, context); registrationError = '' } return catalog })
  backend.registerAction('paths.pick', (input, ctx) => backend.host.request('moss.local-files/v1','pick',input,{ signal:ctx.signal }))
  backend.registerAction('tasks.start', (input, ctx) => startTask(input, ctx.source?.surface === 'tool' ? 'agent-tool' : 'ui', ctx.signal))
  backend.registerAction('tasks.cancel', ({id}) => tasks.cancelTask(id))
  backend.registerAction('tasks.get', async ({id}) => {
    const task = await store.get(id)
    const log = await fs.readFile(path.join(store.directory(id),'stderr.log'),'utf8').catch(() => '')
    return { ...await view(task), log:log.slice(-64000) }
  })
  backend.registerAction('artifacts.read', async ({id,index}) => {
    const {target} = await artifact(id,index)
    if ((await fs.stat(target)).size > 2*1024*1024) throw new Error('结果较大，请导出后处理，或缩小查询范围')
    return {text:await fs.readFile(target,'utf8')}
  })
  backend.registerAction('artifacts.export', async ({id,index},ctx) => {
    const {target} = await artifact(id,index)
    const {paths} = await backend.host.request('moss.local-files/v1','pick',{kind:'directory',multiple:false},{signal:ctx.signal})
    if (!paths.length) return {canceled:true}
    const name=path.parse(target)
    for(let n=0;n<1000;n++) {
      const destination=path.join(paths[0],`${name.name}${n ? ` (${n})` : ''}${name.ext}`)
      try { await fs.copyFile(target,destination,constants.COPYFILE_EXCL); return {path:destination} }
      catch(error) { if(error.code!=='EEXIST') throw error }
    }
    throw new Error('目标目录同名文件过多')
  })
  if (typeof process.send === 'function') for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    void shutdown().catch(error => console.error(error)).finally(() => process.exit(0))
  })
  backend.start(); return backend
}
