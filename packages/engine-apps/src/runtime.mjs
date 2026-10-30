import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { restoreBundledAsset } from './bundled.mjs'
import { platformAsset } from './platform.mjs'

export async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
  await fs.rename(temp, file)
}
export async function hash(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}
export function argv(values) {
  if (!Array.isArray(values) || values.length > 1000 || values.some(v => typeof v !== 'string' || v.includes('\0') || v.length > 16000)) throw new Error('参数必须是独立字符串组成的数组')
  return values
}
export const WORKER_READY_MESSAGE = 'moss.engine.worker-ready'
export const WORKER_START_MESSAGE = 'moss.engine.worker-start'
const parentDisconnectedCode = 'ENGINE_PARENT_DISCONNECTED'

/** A worker starts only after its parent explicitly says so, then watches the parent connection. */
export function waitForWorkerStart() {
  if (typeof process.send !== 'function' || !process.connected) throw new Error('工作进程缺少任务后台连接')
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let started = false, disconnected = false
    const onDisconnect = () => {
      if (disconnected) return
      disconnected = true
      const error = Object.assign(new Error('任务后台连接已断开'), { code: parentDisconnectedCode })
      controller.abort(error)
      process.off('message', onMessage)
      if (!started) reject(error)
    }
    const onMessage = message => {
      if (message?.type !== WORKER_START_MESSAGE) return
      process.off('message', onMessage)
      if (!process.connected) return onDisconnect()
      started = true
      // Keep the connection for parent-loss detection without keeping a finished task alive.
      process.channel?.unref?.()
      resolve(controller.signal)
    }
    process.once('disconnect', onDisconnect)
    process.on('message', onMessage)
    try { process.send({ type: WORKER_READY_MESSAGE }, error => { if (error) onDisconnect() }) }
    catch { onDisconnect() }
  })
}
export function run(executable, args, { cwd, env, signal, log, onStdout, captureStdout = true,
  maxBytes = 16 * 1024 * 1024, allowFailure = false } = {}) {
  argv(args); signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', stdoutBytes = 0, overflow = false, timer, stopping = false, spawnError, streamError
    let streaming = Promise.resolve()
    const stop = () => {
      if (stopping) return
      stopping = true
      child.kill('SIGTERM')
      timer = setTimeout(() => child.kill('SIGKILL'), 1500)
      timer.unref()
    }
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', chunk => {
      if (streamError) return
      const text = chunk.toString()
      if (captureStdout && !overflow) {
        if (stdoutBytes + chunk.length > maxBytes) { overflow = true; stop() }
        else { stdout += text; stdoutBytes += chunk.length }
      }
      if (!onStdout) return
      try {
        const pending = onStdout(text, chunk)
        if (pending && typeof pending.then === 'function') {
          // An async consumer can write to disk without buffering the child output in memory.
          child.stdout.pause()
          streaming = Promise.resolve(pending).then(
            () => child.stdout.resume(),
            error => { streamError = error; stop(); child.stdout.resume() },
          )
        }
      } catch (error) { streamError = error; stop() }
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-64000); log?.(chunk.toString()) })
    child.once('error', error => { spawnError = error })
    child.once('close', (code, exitSignal) => { void streaming.then(() => finish(spawnError || streamError, code, exitSignal)) })
    function finish(error, code, exitSignal) {
      signal?.removeEventListener('abort', stop); clearTimeout(timer)
      if (error) reject(error)
      else if (signal?.aborted) reject(signal.reason || new Error('任务已取消'))
      else if (overflow) reject(new Error('引擎输出超过 16 MiB，请缩小查询范围'))
      else if (code !== 0 && !allowFailure) reject(Object.assign(new Error(stderr.trim() || `引擎退出：${code ?? exitSignal}`), { exitCode: code, stdout, stderr }))
      else resolve({ stdout, stderr, code })
    }
  })
}

export async function ensureBinary(spec, dataDir, signal) {
  signal?.throwIfAborted()
  spec = platformAsset(spec)
  const bundled = fileURLToPath(new URL(`../engines/${spec.id}/${spec.version}/${spec.executable}`, import.meta.url))
  const cached = path.join(dataDir, 'engines', spec.id, spec.version, spec.executable)
  const binary = await restoreBundledAsset(bundled, cached, spec.binarySha256, signal)
  await fs.chmod(binary, 0o755); return binary
}

const taskIdPattern = /^[a-f0-9-]{36}$/
const createdEntryPattern = /^(\d{16})-([a-f0-9-]{36})$/
const readBatchSize = 32
function processExists(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code === 'ESRCH' ? false : null }
}
function workerArgsMatch(args, dataDir, id) {
  return args.length >= 4 && args.at(-2) === dataDir && args.at(-1) === id
}
async function workerProcessState(task, dataDir) {
  const pid = task.pid
  if (!Number.isSafeInteger(pid) || pid <= 0) return 'gone'
  if (processExists(pid) === false) return 'gone'
  // The queue launches workers with dataDir and task ID as the final two args.
  // Checking those args avoids treating an unrelated process with a recycled PID
  // as an old worker, without requiring new fields in existing task records.
  if (process.platform === 'linux') {
    try {
      const command = await fs.readFile(`/proc/${pid}/cmdline`)
      if (!command.length) return 'gone' // A zombie cannot save another result.
      const args = command.toString('utf8').split('\0')
      if (!args.at(-1)) args.pop()
      return workerArgsMatch(args, dataDir, task.id) ? 'worker' : 'other'
    } catch {} // /proc may be unavailable or restricted; use ps below.
  }
  const command = await new Promise(resolve => {
    execFile('ps', ['-ww', '-p', String(pid), '-o', 'args='], { timeout: 2000, maxBuffer: 256 * 1024 },
      (error, stdout) => resolve(error ? null : stdout.trimEnd()))
  })
  if (command === null || !command) return processExists(pid) === false ? 'gone' : 'unknown'
  return command.endsWith(` ${dataDir} ${task.id}`) ? 'worker' : 'other'
}
async function eachLimited(items, concurrency, visit) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await visit(items[next++])
  }))
}

export function sessionResourceUri(uri, sessionId) {
  if (!sessionId) return uri
  const value = new URL(uri); value.searchParams.set('session', sessionId); return value.href
}

export class TaskStore {
  constructor(dataDir, { cacheDir = process.env.MOSS_ENGINE_CACHE_DIR || dataDir, sessionId = process.env.MOSS_TASK_SESSION_ID } = {}) {
    this.cacheDir = cacheDir; this.sessionId = sessionId
    this.dataDir = dataDir; this.root = path.join(dataDir, 'jobs')
    this.createdRoot = path.join(this.root, '.created')
    this.pendingRoot = path.join(this.root, '.pending')
  }
  directory(id) { if (!taskIdPattern.test(id)) throw new Error('任务 ID 无效'); return path.join(this.root, id) }
  createdEntry(task) {
    this.directory(task.id)
    if (!Number.isSafeInteger(task.createdAt) || task.createdAt < 0) throw new Error('任务创建时间无效')
    return `${String(task.createdAt).padStart(16, '0')}-${task.id}`
  }
  async index(task) {
    await fs.mkdir(this.createdRoot, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(this.createdRoot, this.createdEntry(task)), '', { flag: 'wx', mode: 0o600 }).catch(error => {
      if (error.code !== 'EEXIST') throw error
    })
  }
  newTask(input, source) {
    return { id: randomUUID(), ...(this.sessionId ? { sessionId: this.sessionId } : {}), input, source, status: 'queued', createdAt: Date.now(), message: '准备运行', artifacts: [] }
  }
  async create(input, source = 'ui') {
    const task = this.newTask(input, source)
    await this.write(task); await this.index(task).catch(() => {}); return task
  }
  async createQueued(input, source = 'ui') {
    const task = this.newTask(input, source), marker = path.join(this.pendingRoot, task.id)
    await fs.mkdir(this.pendingRoot, { recursive: true, mode: 0o700 })
    await fs.writeFile(marker, '', { flag: 'wx', mode: 0o600 })
    try { await this.write(task) }
    catch (error) { await fs.rm(marker, { force: true }); throw error }
    await this.index(task).catch(() => {})
    return task
  }
  async write(task) { await atomic(path.join(this.directory(task.id), 'task.json'), task); return task }
  async read(id) {
    const task = JSON.parse(await fs.readFile(path.join(this.directory(id), 'task.json'), 'utf8'))
    if (task.id !== id) throw new Error('任务记录 ID 不匹配')
    return task
  }
  async get(id) {
    const task = await this.read(id)
    if (['running', 'queued'].includes(task.status) && task.pid) {
      try { process.kill(task.pid, 0) }
      catch (error) { if (error.code === 'ESRCH') return { ...task, status: 'interrupted', message: '运行进程已停止，可调整参数后重试' } }
    }
    return task
  }
  async list({ limit = 200 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('任务列表上限必须在 1–200 之间')
    await fs.mkdir(this.root, { recursive: true })
    await fs.mkdir(this.createdRoot, { recursive: true, mode: 0o700 })
    const [names, indexedNames] = await Promise.all([fs.readdir(this.root), fs.readdir(this.createdRoot)])
    const ids = new Set(names.filter(name => taskIdPattern.test(name)))
    const indexedIds = new Set(indexedNames.map(name => createdEntryPattern.exec(name)?.[2]).filter(Boolean))
    const entries = indexedNames.filter(name => createdEntryPattern.test(name) && ids.has(name.slice(17)))
    // The first call indexes all legacy task files with bounded concurrency.
    // Later calls read task JSON from the newest page only.
    await eachLimited([...ids].filter(id => !indexedIds.has(id)), 16, async id => {
      try {
        const task = await this.read(id)
        const entry = this.createdEntry(task)
        entries.push(entry)
        await this.index(task).catch(() => {})
      } catch {}
    })
    entries.sort((a, b) => b.localeCompare(a))
    const tasks = [], seen = new Set()
    let offset = 0
    while (offset < entries.length && tasks.length < limit) {
      const count = Math.min(readBatchSize, limit - tasks.length)
      const batch = entries.slice(offset, offset + count).filter(entry => {
        const id = entry.slice(17)
        if (seen.has(id)) return false
        seen.add(id); return true
      })
      offset += count
      const rows = await Promise.all(batch.map(entry => this.get(entry.slice(17)).catch(() => null)))
      for (const task of rows) if (task) tasks.push(task)
    }
    return tasks.slice(0, limit)
  }
  async pending({ includeClaimed = false } = {}) {
    await fs.mkdir(this.pendingRoot, { recursive: true, mode: 0o700 })
    const ids = (await fs.readdir(this.pendingRoot)).filter(id => taskIdPattern.test(id))
    const queued = [], claimed = []
    await eachLimited(ids, 16, async id => {
      const task = await this.read(id).catch(() => null)
      if (task?.status === 'queued' && !task.pid) queued.push(task)
      else if (task && ['queued', 'running'].includes(task.status)) claimed.push(id)
      else await this.dequeue(id)
    })
    queued.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    return includeClaimed ? { queued, claimed } : queued
  }
  async reconcileClaim(id) {
    const task = await this.read(id).catch(() => null)
    if (!task || !['queued', 'running'].includes(task.status)) {
      await this.dequeue(id)
      return true
    }
    const processState = await workerProcessState(task, this.dataDir)
    if (processState === 'worker' || processState === 'unknown') return false
    // The old worker may have saved a terminal result between our first read and PID check.
    const current = await this.read(id).catch(() => null)
    if (!current || !['queued', 'running'].includes(current.status)) {
      await this.dequeue(id)
      return true
    }
    if (current.pid !== task.pid || current.status !== task.status) return false
    const final = { ...current, status: 'interrupted', message: '原工作进程已退出，请重试', finishedAt: Date.now() }
    delete final.pid
    await this.write(final)
    await this.dequeue(id)
    return true
  }
  async dequeue(id) { this.directory(id); await fs.rm(path.join(this.pendingRoot, id), { force: true }) }
  async isCanceled(id) { return Boolean(await fs.stat(path.join(this.directory(id), 'cancel')).catch(() => null)) }
  async cancel(id) {
    const task = await this.get(id)
    if (['running', 'queued'].includes(task.status)) await fs.writeFile(path.join(this.directory(id), 'cancel'), '')
    return task
  }
}

export async function executeTask(engine, store, task, externalSignal) {
  const controller = new AbortController(), directory = store.directory(task.id)
  let interrupted = false
  const cancel = () => controller.abort(new Error('任务已取消'))
  const stop = () => {
    if (controller.signal.aborted) return
    interrupted = true
    controller.abort(new Error('任务后台已关闭，请重试'))
  }
  const abortExternal = () => {
    if (externalSignal.reason?.code === parentDisconnectedCode) stop()
    else cancel()
  }
  externalSignal?.addEventListener('abort', abortExternal, { once:true }); if(externalSignal?.aborted) abortExternal()
  const poll = setInterval(() => { fs.access(path.join(directory, 'cancel')).then(cancel, () => {}) }, 150)
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  let logWrites = Promise.resolve()
  const log = text => { logWrites = logWrites.then(() => fs.appendFile(path.join(directory, 'stderr.log'), text)) }
  Object.assign(task, { status: 'running', pid: process.pid, message: '正在处理', startedAt: Date.now() }); await store.write(task)
  try {
    if (await fs.stat(path.join(directory, 'cancel')).catch(() => null)) cancel()
    controller.signal.throwIfAborted()
    const result = await engine.execute(task.input, { dataDir: store.dataDir, cacheDir: store.cacheDir, sessionId: store.sessionId, directory, signal: controller.signal, log,
      record: async fields => { Object.assign(task, fields); await store.write(task) },
      progress: async message => { task.message = message; await store.write(task) } })
    controller.signal.throwIfAborted()
    Object.assign(task, result, { status: result.status || 'succeeded', message: result.message || '处理完成' })
  } catch (error) {
    const canceled = await store.isCanceled(task.id)
    Object.assign(task, { status: canceled || (controller.signal.aborted && !interrupted) ? 'canceled' : interrupted ? 'interrupted' : 'failed', message: String(error.message || error).slice(-6000), exitCode: error.exitCode ?? null, ...(error.result ? { result:error.result } : {}) })
  } finally {
    clearInterval(poll); externalSignal?.removeEventListener('abort', abortExternal); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop)
    await logWrites; task.finishedAt = Date.now(); delete task.pid; await store.write(task)
  }
  return task
}

export async function existingPaths(values, kind = 'file') {
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error('请选择 1–100 个本地路径')
  return Promise.all(values.map(async value => {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('请使用本地绝对路径')
    const file = await fs.realpath(value), stat = await fs.stat(file)
    if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error(`路径类型错误：${value}`)
    return file
  }))
}
