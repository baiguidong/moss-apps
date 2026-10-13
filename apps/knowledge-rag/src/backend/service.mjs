import fs from 'node:fs/promises'
import { constants, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { connectEngine } from './mcp.mjs'
import { engineEnvironment } from './proxy.mjs'
import { Preparation, cleanOutput, lineCollector } from './preparation.mjs'

export const ENGINE_VERSION = '4.11.0'
export const EMBEDDING_MODEL = 'intfloat/multilingual-e5-small'
export const SUPPORTED = new Set(['.md','.txt','.pdf','.docx','.xlsx','.pptx','.csv','.json','.py','.js','.ts','.tsx','.jsx','.go','.rs','.yaml','.yml','.xml','.sql','.sh'])
const pythonAt = root => path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
export function pageContent(content, offset = 0, limit = 32000) {
  const start = Math.max(0, Math.trunc(offset)), size = Math.max(1, Math.min(60000, Math.trunc(limit)))
  return { content: content.slice(start, start + size), offset: start, nextOffset: start + size < content.length ? start + size : null, totalLength: content.length }
}
export function relativeDocument(root, source) {
  if (typeof source !== 'string' || !source || source.includes('\0')) throw new Error('文档路径无效')
  const resolved = path.resolve(root, source), relative = path.relative(root, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文档不属于此知识库')
  return relative.split(path.sep).join('/')
}
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
export class KnowledgeService {
  constructor({ dataDir, resourcesDir, getPython, register, onChanged = () => {}, enginePython, modelsCache }) {
    Object.assign(this, { dataDir, resourcesDir, getPython, register, onChanged, enginePython, modelsCache })
    this.engineRoot = path.join(dataDir, 'engine')
    this.documentsDir = path.join(this.engineRoot, 'documents')
    this.venv = path.join(dataDir, 'python-env')
    this.state = 'not-installed'
    this.message = ''
    this.error = null
    this.connection = null
    this.process = null
    this.operation = null
    this.closed = false
    this.generation = 0
    this.logs = ''
    this.controller = new AbortController()
    this.queue = Promise.resolve()
    this.preparation = null
    this.progressTimer = null
  }
  requirementsHash() { return createHash('sha256').update(readFileSync(path.join(this.resourcesDir, 'requirements.lock'))).digest('hex') }
  installed() {
    if (this.enginePython) return true
    try {
      const ready = JSON.parse(readFileSync(path.join(this.venv, 'ready.json'), 'utf8'))
      return ready.version === ENGINE_VERSION && ready.requirementsSha256 === this.requirementsHash() && existsSync(pythonAt(this.venv))
    } catch { return false }
  }
  async prepareStorage() {
    await fs.mkdir(this.documentsDir, { recursive: true })
    // Python resolves paths before persisting sources (e.g. /var → /private/var
    // on macOS). Compare against the same canonical directory.
    this.documentsDir = await fs.realpath(this.documentsDir)
  }
  status() { return { state: this.state, installed: this.installed(), message: this.message, error: this.error,
    version: ENGINE_VERSION, model: EMBEDDING_MODEL, toolScopeDefault: 'session', pid: this.process?.pid ?? null,
    url: this.state === 'ready' ? this.url : null, documentRoot: this.documentsDir, preparation: this.preparation?.snapshot() ?? null } }
  emitProgress() {
    if (this.closed || this.progressTimer) return
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null
      if (!this.closed) this.onChanged(this.status())
    }, 200)
    this.progressTimer.unref?.()
  }
  step(id, message) {
    this.message = message
    this.preparation?.step(id, message)
  }
  change(state, message = '', error = null) {
    this.state = state; this.message = message; this.error = error
    if (!this.closed) this.onChanged(this.status())
  }
  async initialize() {
    await this.prepareStorage()
    if (this.installed()) this.begin('start')
  }
  begin(kind = 'start') {
    if (this.closed) throw new Error('知识库已关闭')
    if (this.operation) return this.status()
    if (this.state === 'ready' && this.connection && this.process) return this.status()
    const install = kind === 'install' && !this.installed()
    this.preparation = new Preparation(install, () => this.emitProgress())
    this.change(install ? 'installing' : 'starting', '正在检查本地引擎…')
    const operation = Promise.resolve().then(async () => {
      try {
        if (install) await this.install()
        this.controller.signal.throwIfAborted()
        await this.start()
        this.preparation.finish('done')
      } catch (error) {
        this.preparation.finish(this.controller.signal.aborted ? 'cancelled' : 'failed')
        if (!this.closed && !this.controller.signal.aborted) {
          const label = this.preparation.steps.find(step => step.id === this.preparation.stage)?.label
          this.change('failed', label ? `${label}未完成，可以重试。` : '引擎准备未完成，可以重试。', cleanOutput(error.message))
        }
      }
    })
    this.operation = operation
    void operation.finally(() => { if (this.operation === operation) this.operation = null })
    return this.status()
  }
  async cancelPreparation() {
    if (!['installing', 'starting'].includes(this.state)) return this.status()
    this.change(this.state, '正在取消，请稍候…')
    this.controller.abort(new Error('已取消引擎准备'))
    await this.stopProcess()
    await this.operation
    if (!this.closed) {
      this.controller = new AbortController()
      this.change(this.installed() ? 'failed' : 'not-installed', '已取消，可以稍后重试。')
    }
    return this.status()
  }
  async command(command, args, signal = this.controller.signal) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)])
    signal.throwIfAborted()
    const env = await engineEnvironment()
    signal.throwIfAborted()
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore','pipe','pipe'], windowsHide: true, env: { ...env, PYTHONUNBUFFERED: '1' } })
      let output = '', killTimer
      const collectors = [child.stdout, child.stderr].map(stream => {
        const collector = lineCollector(line => { output = (output + '\n' + cleanOutput(line)).slice(-5000); this.preparation?.output(line) })
        stream.setEncoding('utf8'); stream.on('data', chunk => collector.write(chunk))
        return collector
      })
      const cancel = () => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000) }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      child.once('error', reject)
      child.once('close', code => {
        collectors.forEach(collector => collector.end())
        clearTimeout(killTimer); signal.removeEventListener('abort', cancel)
        if (signal.aborted) reject(signal.reason)
        else if (code !== 0) reject(new Error(`引擎准备失败 (${code})：${output}`))
        else resolve()
      })
    })
  }
  async install() {
    if (this.installed()) return
    this.step('environment', '正在检查 Python 并创建独立运行环境…')
    const python = await this.getPython(this.controller.signal)
    this.controller.signal.throwIfAborted()
    if (!python?.available || !python.path) throw new Error('请先在 Moss 中安装 Python 运行环境，然后重试。')
    await this.command(python.path, ['-m','venv', this.venv])
    this.step('dependencies', '正在下载并校验引擎依赖，已下载的依赖会复用…')
    await this.command(pythonAt(this.venv), ['-m','pip','install','--disable-pip-version-check','--progress-bar','on','--timeout','30','--retries','2','--cache-dir',path.join(this.engineRoot,'pip-cache'),'--require-hashes','-r',path.join(this.resourcesDir,'requirements.lock')])
    await this.command(pythonAt(this.venv), ['-c', `from importlib.metadata import version; assert version('knowledge-rag') == '${ENGINE_VERSION}'`])
    const marker = path.join(this.venv, 'ready.json')
    await fs.writeFile(`${marker}.tmp`, JSON.stringify({ version: ENGINE_VERSION, requirementsSha256: this.requirementsHash() }), { mode: 0o600 })
    await fs.rename(`${marker}.tmp`, marker)
  }
  async start() {
    if (this.connection && this.process) return
    if (!this.installed()) throw new Error('请先准备检索引擎。')
    this.change('starting', '正在检查本地模型…')
    this.step('model', '正在校验已下载的多语言模型，缺失或损坏的文件会重新下载…')
    await this.stopProcess()
    await this.prepareStorage()
    const generation = ++this.generation
    const models = this.modelsCache || path.join(this.engineRoot, 'models')
    await this.command(this.enginePython || pythonAt(this.venv), [path.join(this.resourcesDir, 'prepare_model.py'), models])
    this.controller.signal.throwIfAborted()
    this.step('service', '正在加载模型、检查索引并启动本地服务…')
    const port = await freePort(), token = randomBytes(32).toString('hex')
    this.url = `http://127.0.0.1:${port}/mcp`
    const config = {
      paths: { documents_dir: this.documentsDir, data_dir: path.join(this.engineRoot,'data'), models_cache_dir: models },
      models: { embedding: { profile: 'custom', model: EMBEDDING_MODEL, dimensions: 384, query_prefix: 'query: ', passage_prefix: 'passage: ', gpu: false }, reranker: { enabled: false } },
      documents: { supported_formats: [...SUPPORTED], embed_batch_size: 8, chunking: { chunk_size: 1000, chunk_overlap: 200 } },
      search: { default_results: 5, max_results: 100 }, category_mappings: {}, keyword_routes: {}, query_expansions: {},
      server: { transport: 'streamable-http', host: '127.0.0.1', port, auth: { bearer_token: token } },
    }
    await fs.mkdir(this.engineRoot, { recursive: true })
    await fs.writeFile(path.join(this.engineRoot,'config.yaml'), JSON.stringify(config, null, 2), { mode: 0o600 })
    this.logs = ''
    const env = await engineEnvironment()
    this.controller.signal.throwIfAborted()
    const child = spawn(this.enginePython || pythonAt(this.venv), [path.join(this.resourcesDir,'run_engine.py')], {
      cwd: this.engineRoot, windowsHide: true, stdio: ['ignore','pipe','pipe'],
      env: { ...env, PYTHONUNBUFFERED: '1', KNOWLEDGE_RAG_DIR: this.engineRoot, KNOWLEDGE_RAG_SINGLE_INSTANCE: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', ANONYMIZED_TELEMETRY: 'False', TOKENIZERS_PARALLELISM: 'false' },
    })
    this.process = child
    this.processDone = new Promise(resolve => child.once('close', resolve))
    let exitError
    const collectors = [child.stdout, child.stderr].map(stream => {
      const collector = lineCollector(line => {
        const safe = cleanOutput(line.split(token).join('[hidden]'))
        this.logs = (this.logs + '\n' + safe).slice(-12000)
        this.preparation?.output(safe)
      })
      stream.setEncoding('utf8'); stream.on('data', value => collector.write(value))
      return collector
    })
    child.once('close', () => collectors.forEach(collector => collector.end()))
    child.on('error', error => { exitError = error })
    child.once('exit', code => {
      if (this.process === child) this.process = null
      if (!this.closed && this.generation === generation) {
        this.connection?.close().catch(() => {}); this.connection = null
        this.change('failed', '', `检索服务已退出 (${code})：${this.logs.slice(-3000)}`)
      }
    })
    try {
      const deadline = Date.now() + 180000
      let healthy = false
      while (Date.now() < deadline) {
        this.controller.signal.throwIfAborted()
        if (exitError) throw exitError
        if (child.exitCode !== null || this.process !== child) throw new Error(this.error || this.logs.slice(-3000) || '检索服务启动失败')
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(1500)]) })
          if (response.ok) { healthy = true; break }
        } catch (error) { if (this.controller.signal.aborted) throw error }
        await delay(350, undefined, { signal: this.controller.signal })
      }
      if (!healthy) throw new Error(`本地服务启动超过 3 分钟，请查看最近输出后重试。${this.logs.slice(-1500)}`)
      this.preparation?.output('本地服务已响应，正在检查检索工具…')
      this.connection = await connectEngine(this.url, token, this.controller.signal)
      const tools = await this.connection.client.listTools({}, { signal: this.controller.signal, timeout: 15000 })
      if (!tools.tools.some(tool => tool.name === 'search_knowledge')) throw new Error('服务未提供知识检索工具')
      // Recover copies committed before a cancellation/crash, including when an
      // older non-empty index would make upstream skip its initial scan.
      this.step('index', '正在恢复索引任务；资料处理进度将在连接后继续显示…')
      await this.connection.call('reindex_documents', {}, { signal: this.controller.signal })
      this.step('connect', '正在将检索工具连接到 Moss…')
      await this.register?.({ type: 'http', url: this.url, headers: { Authorization: `Bearer ${token}` } }, this.controller.signal)
      this.controller.signal.throwIfAborted()
      this.change('ready', '本地检索服务已连接')
    } catch (error) { await this.stopProcess(); throw error }
  }
  async stopProcess() {
    ++this.generation
    await this.connection?.close().catch(() => {}); this.connection = null
    const child = this.process, done = this.processDone; this.process = null; this.processDone = null
    if (child) {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      try { if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await done }
      finally { clearTimeout(timer) }
    }
  }
  async close() {
    this.closed = true; this.controller.abort(new Error('知识库已关闭'))
    clearTimeout(this.progressTimer)
    await this.stopProcess(); await this.operation; await this.queue.catch(() => {})
  }
  async call(name, input = {}, options = {}) {
    if (this.state !== 'ready' || !this.connection) throw new Error(this.error || '知识库尚未就绪，请先准备或启动引擎。')
    return this.connection.call(name, input, { ...options, signal: options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal })
  }
  async overview(options = {}) {
    const status = this.status()
    if (this.state !== 'ready') return status
    try { return { ...status, reindex: (await this.call('get_reindex_status', {}, options)).reindex } }
    catch (error) { return { ...status, error: error.message } }
  }
  normalizeDocument(document) {
    const source = document.source || document.filepath
    const filepath = relativeDocument(this.documentsDir, source)
    return { ...document, filepath, filename: document.filename || path.basename(filepath) }
  }
  async list({ offset = 0, limit = 50, category } = {}, options = {}) {
    const result = await this.call('list_documents', category ? { category } : {}, options)
    const documents = (result.documents || []).map(item => this.normalizeDocument(item))
    const start = Math.max(0, Math.trunc(offset)), count = Math.min(100, Math.max(1, Math.trunc(limit)))
    return { items: documents.slice(start, start + count), total: documents.length, nextOffset: start + count < documents.length ? start + count : null }
  }
  async search({ query, limit = 5, category } = {}, options = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 1000) throw new Error('请输入 1–1000 字的检索问题')
    const result = await this.call('search_knowledge', { query: query.trim(), max_results: Math.max(1, Math.min(100, limit)), snippet_mode: false, hybrid_alpha: 0.7, ...(category ? { category } : {}) }, options)
    return { items: (result.results || []).map(item => ({ ...this.normalizeDocument(item), content: String(item.content || '').slice(0, 12000) })) }
  }
  async read({ filepath, offset = 0 } = {}, options = {}) {
    const relative = relativeDocument(this.documentsDir, filepath)
    const resolved = await fs.realpath(path.join(this.documentsDir, relative))
    relativeDocument(await fs.realpath(this.documentsDir), resolved)
    const result = await this.call('get_document', { filepath: relative }, options)
    const document = result.document || result
    return { ...this.normalizeDocument({ ...document, source: relative }), ...pageContent(String(document.content || ''), offset) }
  }
  async importFiles({ paths } = {}, options = {}) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 200) throw new Error('每次请选择 1–200 个普通文件')
    const operation = this.queue.then(async () => {
      const signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal
      signal.throwIfAborted()
      const { reindex } = await this.call('get_reindex_status', {}, options)
      if (reindex?.active) throw new Error('正在建立索引，请完成后再导入。')
      const written = [], failed = []
      for (const source of paths) {
        signal.throwIfAborted()
        let temporary
        try {
          if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('请选择绝对路径的普通文件')
          const stat = await fs.lstat(source)
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('只支持普通文件，不支持目录和符号链接')
          if (!SUPPORTED.has(path.extname(source).toLowerCase())) throw new Error('暂不支持此文件格式')
          if (stat.size > 50 * 1024 * 1024) throw new Error('单文件不能超过 50 MB')
          const canonical = await fs.realpath(source), id = createHash('sha256').update(canonical).digest('hex').slice(0, 16)
          const destination = path.join(this.documentsDir, 'imports', id, path.basename(source))
          await fs.mkdir(path.dirname(destination), { recursive: true })
          temporary = `${destination}.${randomUUID()}.partial`
          const handle = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
          try {
            const opened = await handle.stat()
            if (!opened.isFile() || opened.size > 50 * 1024 * 1024) throw new Error('文件已变化，请重新选择')
            const content = await handle.readFile()
            if (content.length > 50 * 1024 * 1024) throw new Error('单文件不能超过 50 MB')
            await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
          } finally { await handle.close() }
          signal.throwIfAborted()
          await fs.rename(temporary, destination)
          written.push({ filename: path.basename(source), filepath: relativeDocument(this.documentsDir, destination) })
        } catch (error) { if (signal.aborted) throw error; failed.push({ filename: path.basename(String(source)), error: error.message }) }
        finally { if (temporary) await fs.rm(temporary, { force: true }) }
      }
      const indexing = written.length ? await this.call('reindex_documents', {}, options) : null
      this.onChanged(this.status())
      return { written, failed, indexing }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
