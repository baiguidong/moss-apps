import fs from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { fork } from 'node:child_process'
import { AppBackendClient } from '@moss/app-sdk'

const MAX_FILE = 2 * 1024 ** 3
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', flac: 'audio/flac', txt: 'text/plain; charset=utf-8', json: 'application/json', srt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8' }
export function safeName(name) { return path.basename(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 180) || 'file' }
export function inside(root, file) {
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件不属于当前 App')
  return file
}
export async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await fs.rename(temporary, file)
}

export class LocalTasks {
  constructor({ dataDir, worker, inspect, validate, onChanged = () => {} }) {
    Object.assign(this, { dataDir, worker, inspect, validate, onChanged })
    this.state = { version: 1, files: [], tasks: [] }
    this.writes = Promise.resolve(); this.running = null; this.closed = false
    this.token = randomBytes(32).toString('hex')
  }
  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    this.root = await fs.realpath(this.dataDir)
    this.statePath = path.join(this.root, 'workspace.json')
    try {
      const state = JSON.parse(await fs.readFile(this.statePath, 'utf8'))
      if (state.version !== 1 || !Array.isArray(state.files) || !Array.isArray(state.tasks)) throw new Error('任务记录格式不兼容')
      this.state = state
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const task of this.state.tasks) if (['running', 'queued', 'canceling'].includes(task.status)) Object.assign(task, { status: 'interrupted', message: '上次运行已中断，可重新提交任务', finishedAt: Date.now() })
    this.server = http.createServer((req, res) => { this.serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(404); res.end() }) })
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve) })
    this.base = `http://127.0.0.1:${this.server.address().port}`
    await this.save()
    return this
  }
  save() {
    const data = structuredClone(this.state)
    this.writes = this.writes.then(() => atomicJson(this.statePath, data))
    return this.writes
  }
  changed() { this.onChanged({ updatedAt: Date.now() }) }
  url(file) { return `${this.base}/${this.token}/${file.id}` }
  viewFile(file) { const { relative, previewRelative, ...publicFile } = file; return { ...publicFile, url: this.url(file), ...(previewRelative ? { previewUrl: `${this.url(file)}/preview` } : {}) } }
  overview() { return { files: this.state.files.map(file => this.viewFile(file)), tasks: structuredClone(this.state.tasks) } }
  file(id) { const file = this.state.files.find(file => file.id === id); if (!file) throw new Error('找不到文件，请重新导入'); return file }
  async filePath(file) { return inside(this.root, await fs.realpath(path.join(this.root, file.relative))) }
  async serve(req, res) {
    const host = new URL(this.base).host
    if (req.headers.host !== host || !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { res.writeHead(403); res.end(); return }
    const origin = req.headers.origin
    if (origin && !(origin === 'null' || /^moss-app:\/\//.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))) { res.writeHead(403); res.end(); return }
    const parts = new URL(req.url, this.base).pathname.split('/')
    const preview = parts.length === 4 && parts[3] === 'preview'
    if ((!preview && parts.length !== 3) || parts[1] !== this.token) { res.writeHead(404); res.end(); return }
    const file = this.file(parts[2])
    if (preview && !file.previewRelative) { res.writeHead(404); res.end(); return }
    const filePath = await this.filePath(preview ? { relative: file.previewRelative } : file), stat = await fs.stat(filePath)
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Access-Control-Allow-Headers', 'Range'); res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    let start = 0, end = stat.size - 1, status = 200
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]))
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return }
      status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
    }
    res.writeHead(status, { 'Content-Type': preview ? 'image/png' : MIME[path.extname(file.name).slice(1).toLowerCase()] || 'application/octet-stream', 'Content-Length': Math.max(0, end - start + 1) })
    if (req.method === 'HEAD' || !stat.size) { res.end(); return }
    const stream = createReadStream(filePath, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
  }
  async importFiles(paths, signal) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 50) throw new Error('请选择 1–50 个文件')
    const added = [], errors = []
    for (const original of paths) {
      let destination
      try {
        signal?.throwIfAborted()
        if (typeof original !== 'string' || !path.isAbsolute(original)) throw new Error('需要完整的本地文件路径')
        const source = await fs.realpath(original), stat = await fs.stat(source)
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE) throw new Error('文件应大于 0 且不超过 2 GiB')
        const id = randomUUID(), name = safeName(path.basename(source)), relative = path.join('files', id, name)
        destination = path.join(this.root, relative); await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.copyFile(source, destination, constants.COPYFILE_EXCL)
        signal?.throwIfAborted()
        const { previewPath, ...metadata } = await this.inspect(destination)
        const previewRelative = previewPath ? path.relative(this.root, inside(path.dirname(destination), await fs.realpath(previewPath))) : undefined
        const file = { id, name, relative, previewRelative, size: stat.size, createdAt: Date.now(), role: 'input', ...metadata }
        this.state.files.push(file); added.push(this.viewFile(file))
      } catch (error) { if (destination) await fs.rm(path.dirname(destination), { recursive: true, force: true }); if (signal?.aborted) { await this.save(); this.changed(); throw error }; errors.push({ name: safeName(String(original)), message: error.message }) }
    }
    await this.save(); this.changed(); return { files: added, errors }
  }
  async start(input) {
    if (this.closed) throw new Error('App 正在关闭')
    if (this.state.tasks.filter(t => ['queued', 'running', 'canceling'].includes(t.status)).length >= 10) throw new Error('队列已满，请等待当前任务完成')
    const normalized = this.validate(input, this.state.files)
    const { title, ...parameters } = normalized
    const task = { id: randomUUID(), input: parameters, title: title || '处理文件', status: 'queued', progress: 0, message: '等待处理', createdAt: Date.now(), outputs: [] }
    this.state.tasks.unshift(task); await this.save(); this.changed(); this.pump(); return structuredClone(task)
  }
  pump() {
    if (this.closed || this.running) return
    const task = this.state.tasks.findLast(t => t.status === 'queued'); if (!task) return
    this.running = { task, child: null }
    this.execute(task).catch(error => { task.status = 'failed'; task.message = error.message }).finally(async () => {
      task.finishedAt = Date.now(); this.running = null
      try { await this.save() } catch (error) { task.status = 'failed'; task.message = `保存任务失败：${error.message}` }
      this.changed(); this.pump()
    })
  }
  async execute(task) {
    const outputDir = path.join(this.root, 'tasks', task.id); await fs.mkdir(outputDir, { recursive: true })
    const files = await Promise.all(task.input.fileIds.map(id => this.file(id)).map(async file => ({ ...file, path: await this.filePath(file) })))
    if (this.closed || ['canceling', 'canceled'].includes(task.status)) { task.status = 'canceled'; task.message = '已取消'; return }
    task.status = 'running'; task.message = '正在处理'; await this.save(); this.changed()
    if (this.closed || task.status === 'canceling') { task.status = 'canceled'; task.message = '已取消'; return }
    const child = fork(this.worker, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, MOSS_TASK_WORKER: '1' } })
    this.running.child = child
    const result = await new Promise((resolve, reject) => {
      let settled = false, tail = ''
      const finish = (error, data) => { if (settled) return; settled = true; clearTimeout(limit); error ? reject(error) : resolve(data) }
      const limit = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('处理超过 2 小时，任务已停止')) }, 2 * 60 * 60 * 1000)
      child.stderr.on('data', data => { tail = (tail + data.toString()).slice(-2000) })
      child.on('error', error => finish(error))
      child.on('exit', code => finish(new Error(task.status === 'canceling' ? '已取消' : `处理进程退出（${code}）${tail ? `：${tail}` : ''}`)))
      child.on('message', message => {
        if (message.type === 'progress') { task.progress = Math.max(0, Math.min(99, Number(message.progress) || 0)); task.message = String(message.message || '正在处理').slice(0, 300); this.changed() }
        if (message.type === 'result') finish(null, message.result)
        if (message.type === 'error') finish(new Error(message.message))
      })
      child.send({ type: 'run', input: task.input, files, outputDir, dataDir: this.root })
    }).catch(error => { if (task.status === 'canceling' || this.closed) return { canceled: true }; throw error }).finally(() => { if (child.connected) child.disconnect() })
    if (result?.canceled || task.status === 'canceling') { task.status = 'canceled'; task.message = '已取消'; return }
    for (const output of result.files || []) {
      const absolute = inside(await fs.realpath(outputDir), await fs.realpath(output.path)), stat = await fs.stat(absolute)
      if (!stat.isFile()) throw new Error('处理结果不是文件')
      const previewRelative = output.previewPath ? path.relative(this.root, inside(await fs.realpath(outputDir), await fs.realpath(output.previewPath))) : undefined
      const file = { id: randomUUID(), name: safeName(output.name || path.basename(absolute)), relative: path.relative(this.root, absolute), ...(previewRelative ? {previewRelative} : {}), size: stat.size, createdAt: Date.now(), role: 'output', taskId: task.id, kind: output.kind || 'file', metadata: output.metadata || {} }
      this.state.files.push(file); task.outputs.push(file.id)
    }
    task.status = 'succeeded'; task.progress = 100; task.message = result.message || '处理完成'
  }
  async cancel(id) {
    const task = this.state.tasks.find(t => t.id === id); if (!task) throw new Error('找不到任务')
    if (task.status === 'queued') { task.status = 'canceled'; task.message = '已取消' }
    else if (task.status === 'running') {
      task.status = 'canceling'; task.message = '正在取消'
      const child = this.running?.child
      if (child?.connected) child.send({ type: 'cancel' })
      const timer = setTimeout(() => { if (child && child.exitCode === null) child.kill('SIGKILL') }, 5000); timer.unref()
    }
    await this.save(); this.changed(); return structuredClone(task)
  }
  async exportFiles(ids, host, signal) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error('请选择 1–500 个要导出的文件')
    const files = ids.map(id => this.file(id))
    const { paths } = await host.request('moss.local-files/v1', 'pick', { kind: 'directory', multiple: false }, { signal, timeoutMs: 300000 })
    if (!paths.length) return { canceled: true, files: [] }
    const destination = await fs.realpath(paths[0]); if (!(await fs.stat(destination)).isDirectory()) throw new Error('请选择文件夹')
    const exported = []
    for (const file of files) {
      signal?.throwIfAborted()
      const parsed = path.parse(file.name)
      for (let n = 0; n < 10000; n++) {
        const target = path.join(destination, `${parsed.name}${n ? ` (${n})` : ''}${parsed.ext}`)
        try { await fs.copyFile(await this.filePath(file), target, constants.COPYFILE_EXCL); exported.push(target); break }
        catch (error) { if (error.code !== 'EEXIST' || n === 9999) throw error }
      }
    }
    return { canceled: false, files: exported }
  }
  async close() {
    this.closed = true
    if (this.running) await this.cancel(this.running.task.id)
    if (this.running?.child) { const child = this.running.child; await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5500))]) }
    this.server?.closeAllConnections(); await new Promise(resolve => this.server?.close(resolve) || resolve())
    await this.writes
  }
}

export function startApp({ worker, inspect, validate, extraActions = {} }) {
  let service
  const backend = new AppBackendClient({
    async onInitialize(context) { service = await new LocalTasks({ dataDir: context.dataDir, worker, inspect, validate, onChanged: data => backend.emit('workspace.changed', data) }).initialize() },
    async onShutdown() { await service?.close() },
  })
  backend.registerAction('workspace.get', () => service.overview())
  backend.registerAction('files.pick', async (_, context) => {
    const { paths } = await context.host.request('moss.local-files/v1', 'pick', { kind: 'file', multiple: true }, { signal: context.signal, timeoutMs: 300000 })
    return paths.length ? service.importFiles(paths, context.signal) : { files: [], errors: [] }
  })
  backend.registerAction('files.import', (input, context) => service.importFiles(input.paths, context.signal))
  backend.registerAction('files.export', (input, context) => service.exportFiles(input.ids, context.host, context.signal))
  backend.registerAction('tasks.start', input => service.start(input))
  backend.registerAction('tasks.cancel', input => service.cancel(input.id))
  for (const [name, handler] of Object.entries(extraActions)) backend.registerAction(name, (input, context) => handler(service, input, context))
  backend.start()
  return backend
}
