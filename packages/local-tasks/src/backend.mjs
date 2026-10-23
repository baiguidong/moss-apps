import fs from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { fork } from 'node:child_process'
import { AppBackendClient } from '@moss/app-sdk'

const MAX_FILE = 2 * 1024 ** 3
const ACTIVITY_RENEW_MS = 30_000
const ACTIVITY_RETRY_MS = 5_000
// The Host lease expires after 120 seconds; leave time to stop the worker safely.
const ACTIVITY_FAILURE_MS = 75_000
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', flac: 'audio/flac', txt: 'text/plain; charset=utf-8', json: 'application/json', srt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8' }
export function safeName(name) { return path.basename(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 180) || 'file' }
export function inside(root, file) {
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件不属于当前 App')
  return file
}
async function optionalPreviewRelative(root, directory, previewPath) {
  if (!previewPath) return undefined
  inside(path.resolve(directory), path.resolve(previewPath))
  try {
    const [parent, resolved] = await Promise.all([fs.realpath(directory), fs.realpath(previewPath)])
    inside(parent, resolved)
    if (!(await fs.stat(resolved)).isFile()) throw new Error('预览结果不是文件')
    return path.relative(root, resolved)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
export async function atomicJson(file, value) {
  const contents = JSON.stringify(value)
  try { if (await fs.readFile(file, 'utf8') === contents) return }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, contents, { mode: 0o600 })
  await fs.rename(temporary, file)
}

export class LocalTasks {
  constructor({ dataDir, worker, inspect, validate, onChanged = () => {}, onActivityLog = () => {}, activity = null, artifactUrl = null }) {
    Object.assign(this, { dataDir, worker, inspect, validate, onChanged, onActivityLog, activity, artifactUrl })
    this.state = { version: 1, files: [], tasks: [] }
    this.writes = Promise.resolve(); this.running = null; this.closed = false; this.startReservations = 0
    this.admittingTasks = new Set(); this.admissions = new Set(); this.operations = new Set()
    this.activityTimers = new Map()
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
    if (!this.artifactUrl) {
      this.server = http.createServer((req, res) => { this.serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(404); res.end() }) })
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve) })
      this.base = `http://127.0.0.1:${this.server.address().port}`
    }
    await this.save()
    return this
  }
  save() {
    const data = structuredClone(this.state)
    this.writes = this.writes.catch(() => {}).then(() => atomicJson(this.statePath, data))
    return this.writes
  }
  track(operation) {
    this.operations.add(operation)
    void operation.finally(() => this.operations.delete(operation)).catch(() => {})
    return operation
  }
  runTracked(operation) {
    return this.track(Promise.resolve().then(() => {
      if (this.closed) throw new Error('App 正在关闭')
      return operation()
    }))
  }
  changed() {
    try { Promise.resolve(this.onChanged({ updatedAt: Date.now() })).catch(error => this.activityLog('warn', '发送任务状态更新失败', { error: String(error?.message || error) })) }
    catch (error) { this.activityLog('warn', '发送任务状态更新失败', { error: String(error?.message || error) }) }
  }
  url(file) { return `${this.base}/${this.token}/${file.id}` }
  viewFile(file) {
    const { relative, previewRelative, ...publicFile } = file
    if (!this.artifactUrl) return { ...publicFile, url: this.url(file), ...(previewRelative ? { previewUrl: `${this.url(file)}/preview` } : {}) }
    return Promise.allSettled([this.artifactUrl(relative), previewRelative ? this.artifactUrl(previewRelative) : null]).then(([original, preview]) => {
      if (original.status === 'rejected') throw original.reason
      const previewUrl = preview.status === 'fulfilled' ? preview.value : null
      return { ...publicFile, url: original.value, ...(previewUrl ? { previewUrl } : {}) }
    })
  }
  overview() {
    const snapshot = [...this.state.files], tasks = structuredClone(this.state.tasks)
    if (!this.artifactUrl) return { files: snapshot.map(file => this.viewFile(file)), tasks }
    return (async () => {
      const files = new Array(snapshot.length)
      const unavailableFiles = []
      let firstError
      let next = 0
      await Promise.all(Array.from({ length: Math.min(8, snapshot.length) }, async () => {
        while (next < snapshot.length) {
          const index = next++, file = snapshot[index]
          try { files[index] = await this.viewFile(file) }
          catch (error) { firstError ??= error; unavailableFiles.push({ id: file.id, name: file.name }) }
        }
      }))
      if (snapshot.length && unavailableFiles.length === snapshot.length) throw firstError
      return { files: files.filter(Boolean), tasks, unavailableFiles }
    })()
  }
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
  importFiles(paths, signal) { return this.track(this.importFilesNow(paths, signal)) }
  async importFilesNow(paths, signal) {
    if (this.closed) throw new Error('App 正在关闭')
    if (!Array.isArray(paths) || !paths.length || paths.length > 50) throw new Error('请选择 1–50 个文件')
    const added = [], errors = []
    for (const original of paths) {
      let destination
      try {
        signal?.throwIfAborted()
        if (this.closed) throw new Error('App 正在关闭')
        if (typeof original !== 'string' || !path.isAbsolute(original)) throw new Error('需要完整的本地文件路径')
        const source = await fs.realpath(original), stat = await fs.stat(source)
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE) throw new Error('文件应大于 0 且不超过 2 GiB')
        const id = randomUUID(), name = safeName(path.basename(source)), relative = path.join('files', id, name)
        destination = path.join(this.root, relative); await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.copyFile(source, destination, constants.COPYFILE_EXCL)
        signal?.throwIfAborted()
        if (this.closed) throw new Error('App 正在关闭')
        const { previewPath, ...metadata } = await this.inspect(destination)
        signal?.throwIfAborted()
        if (this.closed) throw new Error('App 正在关闭')
        const previewRelative = await optionalPreviewRelative(this.root, path.dirname(destination), previewPath)
        const file = { id, name, relative, previewRelative, size: stat.size, createdAt: Date.now(), role: 'input', ...metadata }
        const publicFile = await this.viewFile(file)
        signal?.throwIfAborted()
        if (this.closed) throw new Error('App 正在关闭')
        this.state.files.push(file); added.push(publicFile)
      } catch (error) { if (destination) { this.state.files = this.state.files.filter(file => path.join(this.root, file.relative) !== destination); await fs.rm(path.dirname(destination), { recursive: true, force: true }) }; if (signal?.aborted || this.closed) { await this.save(); try { this.changed() } catch {} throw error }; errors.push({ name: safeName(String(original)), message: error.message }) }
    }
    await this.save(); this.changed(); return { files: added, errors }
  }
  async start(input, signal) {
    if (this.closed) throw new Error('App 正在关闭')
    signal?.throwIfAborted()
    if (this.state.tasks.filter(t => ['queued', 'running', 'canceling'].includes(t.status)).length + this.startReservations >= 10) throw new Error('队列已满，请等待当前任务完成')
    const normalized = this.validate(input, this.state.files)
    const { title, ...parameters } = normalized
    const task = { id: randomUUID(), input: parameters, title: title || '处理文件', status: 'queued', progress: 0, message: '等待处理', createdAt: Date.now(), outputs: [] }
    this.startReservations++
    let finishAdmission
    const admission = new Promise(resolve => { finishAdmission = resolve })
    this.admissions.add(admission)
    let inserted = false
    try {
      await this.beginActivity(task.id)
      if (this.closed) throw new Error('App 正在关闭')
      signal?.throwIfAborted()
      this.state.tasks.unshift(task)
      this.admittingTasks.add(task.id); inserted = true
      await this.save()
      if (this.closed) throw new Error('App 正在关闭')
      signal?.throwIfAborted()
      this.admittingTasks.delete(task.id)
    } catch (error) {
      this.admittingTasks.delete(task.id)
      if (inserted) {
        this.state.tasks = this.state.tasks.filter(item => item !== task)
        try { await this.save() }
        catch (saveError) { this.activityLog('error', '回滚未接收的任务失败', { taskId: task.id, error: saveError.message }) }
      }
      await this.endActivity(task.id)
      throw error
    } finally { this.startReservations--; this.admissions.delete(admission); finishAdmission() }
    try { this.changed() }
    catch (error) { this.activityLog('warn', '发送任务状态更新失败', { taskId: task.id, error: error.message }) }
    this.pump()
    return structuredClone(task)
  }
  async beginActivity(id) {
    if (!this.activity) return
    try {
      const result = await this.activity('begin', id)
      if (result?.active !== true) throw new Error('Host 未确认任务活动')
      if (this.closed) throw new Error('App 正在关闭')
      const lease = { timer: null, pending: null, confirmedAt: Date.now(), failures: 0, ended: false }
      this.activityTimers.set(id, lease)
      this.scheduleActivityRenewal(id, lease, ACTIVITY_RENEW_MS)
    } catch (error) {
      try { await this.activity('end', id) }
      catch (cleanupError) { this.activityLog('warn', '清理未确认的任务活动失败', { taskId: id, error: String(cleanupError?.message || cleanupError) }) }
      throw error
    }
  }
  activityLog(level, message, details) {
    try { Promise.resolve(this.onActivityLog(level, message, details)).catch(() => {}) } catch {}
  }
  scheduleActivityRenewal(id, lease, delay) {
    if (lease.ended || this.closed) return
    lease.timer = setTimeout(() => {
      lease.timer = null
      void this.renewActivity(id, lease).catch(error => this.activityLog('error', '任务活动续约处理失败', { taskId: id, error: error.message }))
    }, delay)
    lease.timer.unref?.()
  }
  async renewActivity(id, lease) {
    if (lease.ended || this.closed || lease.pending || this.activityTimers.get(id) !== lease) return
    if (lease.timer) clearTimeout(lease.timer)
    lease.timer = null
    const request = Promise.resolve().then(() => this.activity('renew', id))
    lease.pending = request
    try {
      const result = await request
      if (result?.active !== true) throw new Error('Host 未确认任务活动')
      if (lease.ended) return
      if (lease.failures) this.activityLog('info', '任务活动续约已恢复', { taskId: id, failures: lease.failures })
      lease.confirmedAt = Date.now()
      lease.failures = 0
      this.scheduleActivityRenewal(id, lease, ACTIVITY_RENEW_MS)
    } catch (error) {
      if (lease.ended) return
      lease.failures++
      const elapsed = Date.now() - lease.confirmedAt
      if (lease.failures === 1 || elapsed >= ACTIVITY_FAILURE_MS) {
        this.activityLog(elapsed >= ACTIVITY_FAILURE_MS ? 'error' : 'warn', '任务活动续约失败', {
          taskId: id, failures: lease.failures, elapsedMs: elapsed, error: error.message,
        })
      }
      if (elapsed >= ACTIVITY_FAILURE_MS) {
        try { await this.stopForActivityFailure(id) }
        catch (failure) { this.activityLog('error', '停止失去活动登记的任务失败', { taskId: id, error: failure.message }) }
        if (this.running?.task.id !== id) await this.endActivity(id)
      } else this.scheduleActivityRenewal(id, lease, ACTIVITY_RETRY_MS)
    } finally {
      if (lease.pending === request) lease.pending = null
    }
  }
  async stopForActivityFailure(id) {
    const task = this.state.tasks.find(item => item.id === id)
    if (!task || !['queued', 'running', 'canceling'].includes(task.status)) return
    const message = 'Host 任务活动续约持续失败，任务已停止，请重试'
    const running = this.running?.task.id === id ? this.running : null
    if (!running) {
      Object.assign(task, { status: 'failed', message, finishedAt: Date.now() })
      await this.save()
      try { this.changed() } catch (error) { this.activityLog('warn', '发送任务状态更新失败', { taskId: id, error: error.message }) }
      return
    }
    running.activityFailure = message
    task.status = 'canceling'; task.message = 'Host 任务活动续约失败，正在停止任务'
    const child = running.child
    if (child) {
      try { if (child.connected) child.send({ type: 'cancel' }) } catch {}
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 5000)
      timer.unref?.()
    }
    try { this.changed() } catch (error) { this.activityLog('warn', '发送任务状态更新失败', { taskId: id, error: error.message }) }
  }
  async endActivity(id) {
    const lease = this.activityTimers.get(id)
    if (!lease) return
    lease.ended = true
    if (lease.timer) clearTimeout(lease.timer)
    this.activityTimers.delete(id)
    await lease.pending?.catch(() => {})
    try { await this.activity('end', id) }
    catch (error) { this.activityLog('warn', '结束任务活动登记失败', { taskId: id, error: error.message }) }
  }
  pump() {
    if (this.closed || this.running) return
    const task = this.state.tasks.findLast(t => t.status === 'queued' && !this.admittingTasks.has(t.id)); if (!task) return
    const running = { task, child: null, done: null }
    this.running = running
    running.done = this.execute(task).then(() => {
      if (running.activityFailure) { task.status = 'failed'; task.message = running.activityFailure }
    }, error => { task.status = 'failed'; task.message = running.activityFailure || error.message }).finally(async () => {
      task.finishedAt = Date.now()
      if (task.status !== 'succeeded' && task.outputs.length === 0) {
        try { await fs.rm(path.join(this.root, 'tasks', task.id), { recursive: true, force: true }) }
        catch (error) { this.activityLog('warn', '清理失败任务的临时文件失败', { taskId: task.id, error: error.message }) }
      }
      try { await this.save() } catch (error) { task.status = 'failed'; task.message = `保存任务失败：${error.message}` }
      await this.endActivity(task.id)
      if (this.running === running) this.running = null
      try { this.changed() }
      catch (error) { this.activityLog('warn', '发送任务状态更新失败', { taskId: task.id, error: error.message }) }
      this.pump()
    })
  }
  async execute(task) {
    const outputDir = path.join(this.root, 'tasks', task.id); await fs.mkdir(outputDir, { recursive: true })
    const files = await Promise.all(task.input.fileIds.map(id => this.file(id)).map(async file => ({ ...file, path: await this.filePath(file) })))
    if (this.running?.activityFailure) throw new Error(this.running.activityFailure)
    if (this.closed || ['canceling', 'canceled'].includes(task.status)) { task.status = 'canceled'; task.message = '已取消'; return }
    task.status = 'running'; task.message = '正在处理'; await this.save(); this.changed()
    if (this.running?.activityFailure) throw new Error(this.running.activityFailure)
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
        if (message.type === 'progress' && !this.running?.activityFailure) { task.progress = Math.max(0, Math.min(99, Number(message.progress) || 0)); task.message = String(message.message || '正在处理').slice(0, 300); this.changed() }
        if (message.type === 'result') finish(null, message.result)
        if (message.type === 'error') finish(new Error(message.message))
      })
      child.send({ type: 'run', input: task.input, files, outputDir, dataDir: this.root })
    }).catch(error => { if (task.status === 'canceling' || this.closed) return { canceled: true }; throw error }).finally(() => { if (child.connected) child.disconnect() })
    if (result?.canceled || task.status === 'canceling') { task.status = 'canceled'; task.message = '已取消'; return }
    const outputFiles = []
    for (const output of result.files || []) {
      const absolute = inside(await fs.realpath(outputDir), await fs.realpath(output.path)), stat = await fs.stat(absolute)
      if (!stat.isFile()) throw new Error('处理结果不是文件')
      const previewRelative = await optionalPreviewRelative(this.root, outputDir, output.previewPath)
      const file = { id: randomUUID(), name: safeName(output.name || path.basename(absolute)), relative: path.relative(this.root, absolute), ...(previewRelative ? {previewRelative} : {}), size: stat.size, createdAt: Date.now(), role: 'output', taskId: task.id, kind: output.kind || 'file', metadata: output.metadata || {} }
      outputFiles.push(file)
    }
    if (this.closed || task.status === 'canceling') { task.status = 'canceled'; task.message = '已取消'; return }
    this.state.files.push(...outputFiles)
    task.outputs.push(...outputFiles.map(file => file.id))
    task.status = 'succeeded'; task.progress = 100; task.message = result.message || '处理完成'
  }
  cancel(id) { return this.track(this.cancelNow(id)) }
  async cancelNow(id) {
    const task = this.state.tasks.find(t => t.id === id); if (!task) throw new Error('找不到任务')
    if (task.status === 'queued') { task.status = 'canceled'; task.message = '已取消'; await this.endActivity(id) }
    else if (task.status === 'running') {
      task.status = 'canceling'; task.message = '正在取消'
      const child = this.running?.child
      if (child?.connected) child.send({ type: 'cancel' })
      const timer = setTimeout(() => { if (child && child.exitCode === null) child.kill('SIGKILL') }, 5000); timer.unref()
    }
    await this.save(); this.changed(); return structuredClone(task)
  }
  exportFiles(ids, host, signal) { return this.track(this.exportFilesNow(ids, host, signal)) }
  async exportFilesNow(ids, host, signal) {
    if (this.closed) throw new Error('App 正在关闭')
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error('请选择 1–500 个要导出的文件')
    const files = ids.map(id => this.file(id))
    const { paths } = await host.request('moss.local-files/v1', 'pick', { kind: 'directory', multiple: false }, { signal, timeoutMs: 300000 })
    if (!paths.length) return { canceled: true, files: [] }
    const destination = await fs.realpath(paths[0]); if (!(await fs.stat(destination)).isDirectory()) throw new Error('请选择文件夹')
    const exported = []
    for (const file of files) {
      signal?.throwIfAborted()
      if (this.closed) throw new Error('App 正在关闭')
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
    const admissions = Promise.allSettled([...this.admissions])
    const operations = Promise.allSettled([...this.operations])
    for (const lease of this.activityTimers.values()) { lease.ended = true; if (lease.timer) clearTimeout(lease.timer) }
    this.activityTimers.clear()
    if (this.running) await this.cancel(this.running.task.id)
    const running = this.running
    if (running?.done) {
      let timer
      try { await Promise.race([running.done, new Promise(resolve => { timer = setTimeout(resolve, 3000) })]) }
      finally { clearTimeout(timer) }
      if (this.running === running) {
        running.child?.kill('SIGKILL')
        try { await Promise.race([running.done, new Promise(resolve => { timer = setTimeout(resolve, 750) })]) }
        finally { clearTimeout(timer) }
      }
    }
    await Promise.all([admissions, operations])
    this.server?.closeAllConnections(); await new Promise(resolve => this.server?.close(resolve) || resolve())
    await this.writes
  }
}

export function startApp({ worker, inspect, validate, extraActions = {} }) {
  let service
  const artifactUrl = relativePath => {
    const key = relativePath.split(path.sep).join('/')
    return backend.host.request('moss.artifacts/v1', 'url.get', { relativePath: key }).then(result => result.url)
  }
  const backend = new AppBackendClient({
    async onInitialize(context) { service = await new LocalTasks({ dataDir: context.dataDir, worker, inspect, validate,
      onChanged: data => backend.emit('workspace.changed', data),
      onActivityLog: (level, message, details) => backend.log(level, message, details),
      activity: context.protocols.includes('moss.runtime/v1') ? (operation, id) => backend.host.request('moss.runtime/v1', `activity.${operation}`, { id }, { timeoutMs: 10_000 }) : null,
      artifactUrl: context.protocols.includes('moss.artifacts/v1') ? artifactUrl : null,
    }).initialize() },
    async onShutdown() { await service?.close() },
  })
  backend.registerAction('workspace.get', () => service.overview())
  backend.registerAction('files.pick', async (_, context) => {
    const { paths } = await context.host.request('moss.local-files/v1', 'pick', { kind: 'file', multiple: true }, { signal: context.signal, timeoutMs: 300000 })
    return paths.length ? service.importFiles(paths, context.signal) : { files: [], errors: [] }
  })
  backend.registerAction('files.import', (input, context) => service.importFiles(input.paths, context.signal))
  backend.registerAction('files.export', (input, context) => service.exportFiles(input.ids, context.host, context.signal))
  backend.registerAction('tasks.start', (input, context) => service.start(input, context.signal))
  backend.registerAction('tasks.cancel', input => service.cancel(input.id))
  for (const [name, handler] of Object.entries(extraActions)) backend.registerAction(name, (input, context) => service.runTracked(() => handler(service, input, context)))
  backend.start()
  return backend
}
