import fs from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { AppBackendClient } from '@moss/app-sdk'
import { TaskStore } from './runtime.mjs'

const mime = { html:'text/html; charset=utf-8', txt:'text/plain; charset=utf-8', md:'text/plain; charset=utf-8', json:'application/json', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', svg:'image/svg+xml', pdf:'application/pdf', mp4:'video/mp4' }
export function startBackend(engine, worker) {
  let store, server, base, context, registrationError = '', catalog
  const token = randomBytes(32).toString('hex'), children = new Set()
  const backend = new AppBackendClient({
    onInitialize: async ctx => {
      context = ctx; store = new TaskStore(ctx.dataDir)
      server = http.createServer((req, res) => { serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(404); res.end() }) })
      await new Promise((resolve,reject) => { server.once('error', reject); server.listen(0,'127.0.0.1',resolve) })
      base = `http://127.0.0.1:${server.address().port}`
      if (engine.register) setImmediate(() => engine.register(backend, ctx).catch(error => { registrationError = error.message }))
    },
    onShutdown: async () => { for (const child of children) child.kill('SIGTERM'); server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); await engine.close?.() },
  })
  async function view(task) {
    return { ...task, artifacts: task.artifacts.map((file, index) => ({ ...file, url: `${base}/${token}/${task.id}/${index}/` })) }
  }
  async function artifact(id, index) {
    const task = await store.get(id), item = task.artifacts[index]
    if (!item || !Number.isInteger(index)) throw new Error('找不到结果文件')
    const target = await fs.realpath(item.path)
    const allowed = [store.directory(id), ...(task.readRoots || [])]
    if (!allowed.some(root => target === root || target.startsWith(root + path.sep))) throw new Error('结果文件不在本次任务目录中')
    return { item, target }
  }
  async function serve(req, res) {
    if (req.headers.host !== new URL(base).host || !['GET','HEAD'].includes(req.method)) { res.writeHead(403); return res.end() }
    const parts = new URL(req.url, base).pathname.split('/')
    if (parts.length !== 5 || parts[1] !== token) { res.writeHead(404); return res.end() }
    const { target } = await artifact(parts[2], Number(parts[3]))
    // Trailing / is intentional so links cannot be confused with shell paths.
    if (parts[4] !== '') { res.writeHead(404); return res.end() }
    const stat = await fs.stat(target), ext = path.extname(target).slice(1).toLowerCase()
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
    res.setHeader('Content-Length',stat.size); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
    if (req.method === 'HEAD') return res.end()
    createReadStream(target).pipe(res)
  }
  backend.registerAction('workspace.get', async () => ({ tasks: await Promise.all((await store.list()).map(view)), engine: { id:engine.id, version:engine.spec.version }, registrationError }))
  backend.registerAction('catalog.get', async () => catalog ??= await engine.catalog({ dataDir: context.dataDir }))
  backend.registerAction('engine.prepare', async () => { catalog = await engine.catalog({ dataDir: context.dataDir, prepare: true }); if (engine.register) { await engine.register(backend, context); registrationError = '' } return catalog })
  backend.registerAction('paths.pick', (input, ctx) => backend.host.request('moss.local-files/v1','pick',input,{ signal:ctx.signal }))
  backend.registerAction('tasks.start', async input => {
    await engine.validate(input)
    const task = await store.create(input)
    const child = spawn(process.execPath, [worker, context.dataDir, task.id], { stdio:['pipe','ignore','ignore'], shell:false })
    children.add(child); child.once('close',() => { children.delete(child); backend.emit('workspace.changed',{}) })
    child.once('error', error => { void store.write({ ...task, status:'failed',message:error.message }) })
    await store.write({ ...task,pid:child.pid }); child.stdin.on('error',()=>{}); child.stdin.end('start'); return task
  })
  backend.registerAction('tasks.cancel', ({id}) => store.cancel(id))
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
  backend.start(); return backend
}
