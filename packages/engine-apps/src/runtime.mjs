import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { restoreBundledAsset } from './bundled.mjs'

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
export function run(executable, args, { cwd, env, signal, log, maxBytes = 16 * 1024 * 1024, allowFailure = false } = {}) {
  argv(args); signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', overflow = false, timer
    const stop = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), 1500); timer.unref() }
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (Buffer.byteLength(stdout) > maxBytes) { overflow = true; stop() } })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-64000); log?.(chunk.toString()) })
    child.once('error', finish)
    child.once('close', (code, exitSignal) => finish(null, code, exitSignal))
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
  if (`${process.platform}-${process.arch}` !== spec.platform) throw new Error(`当前发行版支持 ${spec.platform}`)
  const bundled = fileURLToPath(new URL(`../engines/${spec.id}/${spec.version}/${spec.executable}`, import.meta.url))
  const cached = path.join(dataDir, 'engines', spec.id, spec.version, spec.executable)
  const binary = await restoreBundledAsset(bundled, cached, spec.binarySha256, signal)
  await fs.chmod(binary, 0o755); return binary
}

export class TaskStore {
  constructor(dataDir) { this.dataDir = dataDir; this.root = path.join(dataDir, 'jobs') }
  directory(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('任务 ID 无效'); return path.join(this.root, id) }
  async create(input, source = 'ui') {
    const task = { id: randomUUID(), input, source, status: 'queued', createdAt: Date.now(), message: '准备运行', artifacts: [] }
    await this.write(task); return task
  }
  async write(task) { await atomic(path.join(this.directory(task.id), 'task.json'), task); return task }
  async get(id) {
    const task = JSON.parse(await fs.readFile(path.join(this.directory(id), 'task.json'), 'utf8'))
    if (['running', 'queued'].includes(task.status) && task.pid) {
      try { process.kill(task.pid, 0) } catch { return { ...task, status: 'interrupted', message: '运行进程已停止，可调整参数后重试' } }
    }
    return task
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true })
    return (await Promise.all((await fs.readdir(this.root)).filter(id => /^[a-f0-9-]{36}$/.test(id)).map(id => this.get(id).catch(() => null)))).filter(Boolean).sort((a,b) => b.createdAt - a.createdAt).slice(0, 200)
  }
  async cancel(id) {
    const task = await this.get(id)
    if (['running', 'queued'].includes(task.status)) await fs.writeFile(path.join(this.directory(id), 'cancel'), '')
    return task
  }
}

export async function executeTask(engine, store, task, externalSignal) {
  const controller = new AbortController(), directory = store.directory(task.id)
  const abort = () => controller.abort(new Error('任务已取消'))
  externalSignal?.addEventListener('abort', abort, { once:true }); if(externalSignal?.aborted)abort()
  const poll = setInterval(() => { fs.access(path.join(directory, 'cancel')).then(abort, () => {}) }, 150)
  process.once('SIGTERM', abort); process.once('SIGINT', abort)
  let logWrites = Promise.resolve()
  const log = text => { logWrites = logWrites.then(() => fs.appendFile(path.join(directory, 'stderr.log'), text)) }
  Object.assign(task, { status: 'running', pid: process.pid, message: '正在处理', startedAt: Date.now() }); await store.write(task)
  try {
    if (await fs.stat(path.join(directory, 'cancel')).catch(() => null)) abort()
    const result = await engine.execute(task.input, { dataDir: store.dataDir, directory, signal: controller.signal, log,
      record: async fields => { Object.assign(task, fields); await store.write(task) },
      progress: async message => { task.message = message; await store.write(task) } })
    controller.signal.throwIfAborted()
    Object.assign(task, result, { status: result.status || 'succeeded', message: result.message || '处理完成' })
  } catch (error) {
    Object.assign(task, { status: controller.signal.aborted ? 'canceled' : 'failed', message: String(error.message || error).slice(-6000), exitCode: error.exitCode ?? null, ...(error.result ? { result:error.result } : {}) })
  } finally {
    clearInterval(poll); externalSignal?.removeEventListener('abort',abort); process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort)
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
