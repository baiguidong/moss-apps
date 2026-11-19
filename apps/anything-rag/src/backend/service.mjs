import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { RagStore } from './store.mjs'
import { EmbeddingEngine } from './embedding.mjs'
import { PdfNoTextError, SUPPORTED_EXTENSIONS, mimeFor, parseFile, splitText } from './parsers.mjs'

const limit = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.trunc(Number(value)))) : fallback
const safeError = error => error instanceof Error ? error.message : String(error)

function documentChunks({ content, ocrPages }, metadata) {
  if (!ocrPages) return splitText(content, metadata)
  const chunks = ocrPages.flatMap(({ page, text }) => splitText(text, metadata)
    .map(chunk => ({ ...chunk, metadata: { ...chunk.metadata, page } })))
  return chunks.map((chunk, index) => ({ ...chunk, index, metadata: { ...chunk.metadata, chunkIndex: index } }))
}

export class RagService {
  constructor({ dataDir, bundledModelDir = null, disableNative = false, onChanged = () => {}, getPython = null, pdfParserPath = null, pdfModulePath = null, recognizePdf = null } = {}) {
    this.dataDir = dataDir; this.documentsDir = path.join(dataDir, 'documents'); this.store = new RagStore(path.join(dataDir, 'rag.sqlite')); this.engine = new EmbeddingEngine({ dataDir, bundledModelDir, disableNative, onChanged: () => this.emitChanged() }); this.onChanged = onChanged; this.getPython = getPython; this.pdfParserPath = pdfParserPath; this.pdfModulePath = pdfModulePath; this.closed = false; this.busy = false; this.job = null; this.operationController = null; this.defaultSpaceId = this.store.ensureDefaultSpace();
    this.recognizePdf = recognizePdf
  }
  async resolvePdfPython(signal) {
    const runtime = this.getPython ? await this.getPython(signal) : null
    return { parserPath: this.pdfParserPath, pythonPath: runtime?.available ? runtime.path : null, modulePath: this.pdfModulePath }
  }
  async parseDocument(file, signal, { id, checksum, jobId }) {
    const isPdf = path.extname(file).toLowerCase() === '.pdf'
    const options = { signal }
    if (isPdf && this.pdfParserPath) options.python = { resolve: abortSignal => this.resolvePdfPython(abortSignal) }
    let ocrPages = isPdf ? this.store.getPdfOcr(id, checksum) : null
    if (!ocrPages) {
      try { return { content: await parseFile(file, options), ocrPages: null } }
      catch (error) { if (!(error instanceof PdfNoTextError) || !this.recognizePdf) throw error }
      ocrPages = await this.recognizePdf(file, { signal, onProgress: message => {
        this.store.updateJob(jobId, { message: `${path.basename(file)} · OCR · ${message}` })
        this.emitChanged()
      } })
    }
    return { content: ocrPages.map(({ page, text }) => `第 ${page} 页\n${text}`).join('\n\n'), ocrPages }
  }
  emitChanged() { if (!this.closed) this.onChanged(this.status()) }
  status() { const jobs = this.store.listJobs(); return { state: this.engine.state, engine: this.engine.status(), spaces: this.store.listSpaces(), documents: this.store.listDocuments({ limit: 1 }).total, activeJob: jobs.find(job => job.status === 'running') || null, lastJob: jobs[0] || null, settings: this.settings() } }
  async initialize() { await fs.mkdir(this.documentsDir, { recursive: true }); this.store.recoverInterruptedJobs(); return this.status() }
  async close() { this.closed = true; this.store.close() }
  settings() { return { embeddingModel: this.store.getSetting('embeddingModel', this.engine.model), topK: this.store.getSetting('topK', 5), threshold: this.store.getSetting('threshold', 0.28), hybridAlpha: this.store.getSetting('hybridAlpha', 0.7), rerank: this.store.getSetting('rerank', false), refusal: this.store.getSetting('refusal', true) } }
  async prepare() { return this.engine.prepare({ allowDownload: true }) }
  async retryPrepare() { return this.engine.retry() }
  async cancel() {
    if (this.operationController) {
      if (this.job) this.store.updateJob(this.job, { message: '正在取消…' })
      this.operationController.abort()
      this.emitChanged()
    }
    return this.status()
  }
  listSpaces() { return { spaces: this.store.listSpaces() } }
  createSpace({ name }) { const value = String(name || '').trim(); if (!value || value.length > 80) throw new Error('知识空间名称需为 1–80 个字符'); const id = `space-${randomUUID()}`; return { space: this.store.createSpace(id, value) } }
  updateSpace({ id, name }) { if (!this.store.getSpace(id)) throw new Error('知识空间不存在'); const value = String(name || '').trim(); if (!value || value.length > 80) throw new Error('知识空间名称需为 1–80 个字符'); return { space: this.store.updateSpace(id, value) } }
  deleteSpace({ id }) { if (id === this.defaultSpaceId) throw new Error('默认知识空间不能删除'); this.store.deleteSpace(id); return { deleted: true } }
  async listDocuments(input = {}) { return this.store.listDocuments({ spaceId: input.spaceId || this.defaultSpaceId, offset: limit(input.offset, 0, 1_000_000, 0), limit: limit(input.limit, 1, 100, 50) }) }
  async readDocument({ id, offset = 0, limit: size = 32000 }) { const doc = this.store.getDocument(id); if (!doc) throw new Error('文档不存在'); const start = Math.max(0, Number(offset) || 0), length = limit(size, 1, 60000, 32000); return { ...doc, content: doc.content.slice(start, start + length), offset: start, nextOffset: start + length < doc.content.length ? start + length : null, totalLength: doc.content.length, resourceId: doc.id, uri: `moss-rag://resource/${encodeURIComponent(doc.id)}?revision=${doc.revision}` } }
  async importFiles({ paths, spaceId = this.defaultSpaceId } = {}, context = {}) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 200) throw new Error('请选择 1–200 个文件')
    if (!this.store.getSpace(spaceId)) throw new Error('知识空间不存在')
    if (this.busy) throw new Error('已有索引任务正在运行')
    const jobId = `job-${randomUUID()}`, jobTotal = paths.length
    this.store.createJob(jobId, 'import', jobTotal)
    this.job = jobId; this.busy = true
    const controller = new AbortController(); this.operationController = controller
    const signal = controller.signal
    if (context.signal) context.signal.addEventListener('abort', () => controller.abort(), { once: true })
    this.emitChanged()
    const written = [], failed = []
    try {
      this.store.updateJob(jobId, { message: '准备 embedding 模型…' }); this.emitChanged()
      await this.engine.prepare({ allowDownload: true, signal })
      for (let index = 0; index < paths.length; index++) {
        signal.throwIfAborted()
        const source = paths[index]; let stagingDir, documentId = null
        const filenameForProgress = path.basename(String(source))
        this.store.updateJob(jobId, { message: `${filenameForProgress} · 准备中` }); this.emitChanged()
        try {
          if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('必须选择绝对路径文件')
          const stat = await fs.lstat(source)
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('只支持普通文件，不支持目录或符号链接')
          if (stat.size > 50 * 1024 * 1024) throw new Error('单文件不能超过 50 MB')
          const ext = path.extname(source).toLowerCase()
          if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`暂不支持 ${ext || '此'} 文件格式`)
          const canonical = await fs.realpath(source)
          const sourceId = createHash('sha256').update(`${spaceId}:${canonical}`).digest('hex').slice(0, 24)
          const destDir = path.join(this.documentsDir, spaceId, sourceId), filename = path.basename(source), destination = path.join(destDir, filename)
          await fs.mkdir(destDir, { recursive: true }); signal.throwIfAborted()
          stagingDir = await fs.mkdtemp(path.join(destDir, '.import-'))
          const staged = path.join(stagingDir, filename)
          await fs.copyFile(source, staged); signal.throwIfAborted()
          const checksum = createHash('sha256').update(await fs.readFile(staged)).digest('hex')
          this.store.updateJob(jobId, { message: `${filename} · 解析中` }); this.emitChanged()
          const id = `doc-${sourceId}`
          const parsed = await this.parseDocument(staged, signal, { id, checksum, jobId }); signal.throwIfAborted()
          const sourcePath = path.relative(this.documentsDir, destination).split(path.sep).join('/')
          const chunks = documentChunks(parsed, { title: filename, source: sourcePath })
          this.store.updateJob(jobId, { message: `${filename} · embedding 中` }); this.emitChanged()
          const vectors = await this.engine.embed(chunks.map(chunk => chunk.content), 'passage', { signal }); signal.throwIfAborted()
          await fs.rename(staged, destination)
          const doc = this.store.upsertDocument({ id, spaceId, sourcePath, filename, mime: mimeFor(source), content: parsed.content, checksum, status: 'indexing' })
          documentId = doc.id
          this.store.saveChunks(doc.id, chunks.map((chunk, chunkIndex) => ({ ...chunk, id: `${doc.id}-chunk-${chunkIndex}`, embedding: vectors[chunkIndex] })))
          if (parsed.ocrPages) this.store.savePdfOcr(doc.id, checksum, parsed.ocrPages)
          this.store.setDocumentStatus(doc.id, 'ready')
          written.push({ ...doc, status: 'ready', chunks: chunks.length })
          this.store.updateJob(jobId, { completed: index + 1, message: `${filename} · ${index + 1}/${paths.length}` }); this.emitChanged()
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError') throw error
          const message = safeError(error)
          if (documentId) this.store.setDocumentStatus(documentId, 'error', message)
          failed.push({ filename: path.basename(String(source)), error: message })
          this.store.updateJob(jobId, { completed: index + 1, message: `${path.basename(String(source))} · 失败` }); this.emitChanged()
        } finally {
          if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
        }
      }
      this.store.updateJob(jobId, { status: failed.length && !written.length ? 'failed' : 'done', completed: paths.length, message: failed.length ? `完成，${failed.length} 个文件失败` : '索引完成' })
      return { written, failed, jobId }
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') {
        this.store.updateJob(jobId, { status: 'cancelled', message: '已取消' })
        return { written, failed, jobId, cancelled: true }
      }
      throw error
    } finally { this.busy = false; this.job = null; this.operationController = null; this.emitChanged() }
  }
  async rebuild(context = {}) {
    const docs = this.store.listDocuments({ limit: 100000 }).items
    if (this.busy) throw new Error('已有索引任务正在运行')
    const jobId = `job-${randomUUID()}`; this.store.createJob(jobId, 'rebuild', docs.length)
    this.busy = true; this.job = jobId
    const controller = new AbortController(); this.operationController = controller; const signal = controller.signal
    if (context.signal) context.signal.addEventListener('abort', () => controller.abort(), { once: true })
    this.emitChanged()
    try {
      this.store.updateJob(jobId, { message: '准备 embedding 模型…' }); this.emitChanged()
      await this.engine.prepare({ allowDownload: true, signal })
      for (let index = 0; index < docs.length; index++) {
        signal.throwIfAborted(); const doc = this.store.getDocument(docs[index].id)
        try {
          const full = path.join(this.documentsDir, doc.sourcePath)
          this.store.updateJob(jobId, { message: `${doc.filename} · 解析中` }); this.emitChanged()
          const parsed = await this.parseDocument(full, signal, { id: doc.id, checksum: doc.checksum, jobId }); signal.throwIfAborted()
          const chunks = documentChunks(parsed, { title: doc.filename, source: doc.sourcePath })
          this.store.updateJob(jobId, { message: `${doc.filename} · embedding 中` }); this.emitChanged()
          const vectors = await this.engine.embed(chunks.map(chunk => chunk.content), 'passage', { signal }); signal.throwIfAborted()
          this.store.removeChunks(doc.id)
          this.store.saveChunks(doc.id, chunks.map((chunk, chunkIndex) => ({ ...chunk, id: `${doc.id}-chunk-${chunkIndex}`, embedding: vectors[chunkIndex] })))
          if (parsed.ocrPages) this.store.savePdfOcr(doc.id, doc.checksum, parsed.ocrPages)
          this.store.setDocumentStatus(doc.id, 'ready'); this.store.updateJob(jobId, { completed: index + 1, message: `${doc.filename} · ${index + 1}/${docs.length}` })
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError') throw error
          this.store.setDocumentStatus(doc.id, 'error', safeError(error)); this.store.updateJob(jobId, { completed: index + 1, message: `${doc.filename} · 失败` })
        }
        this.emitChanged()
      }
      this.store.updateJob(jobId, { status: 'done', completed: docs.length, message: '重建完成' }); return { jobId, count: docs.length }
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') { this.store.updateJob(jobId, { status: 'cancelled', message: '已取消' }); return { jobId, count: 0, cancelled: true } }
      throw error
    } finally { this.busy = false; this.job = null; this.operationController = null; this.emitChanged() }
  }
  async search({ query, spaceId = this.defaultSpaceId, topK, threshold, hybridAlpha, rerank } = {}, context = {}) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('请输入检索问题'); const settings = this.settings(); const k = limit(topK, 1, 50, settings.topK), minScore = Number.isFinite(Number(threshold)) ? Math.max(0, Math.min(1, Number(threshold))) : settings.threshold, alpha = Number.isFinite(Number(hybridAlpha)) ? Math.max(0, Math.min(1, Number(hybridAlpha))) : settings.hybridAlpha; await this.engine.prepare({ allowDownload: true }); const [queryVector] = await this.engine.embed([query.trim()], 'query'); const chunks = this.store.listChunks({ spaceId }); const fts = new Map(this.store.searchFts(query, spaceId).map(item => [item.chunkId, item.rank])); const rawTerms = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [...query]; const stopWords = new Set(['a', 'an', 'and', 'are', 'is', 'of', 'or', 'the', 'to', 'what', 'how', 'when', 'where', 'who', 'why', 's']); const terms = [...new Set(rawTerms.flatMap(term => { if (stopWords.has(term)) return []; if (!/[\u3400-\u9fff]/u.test(term)) return [term]; if (term.length < 2) return [...term]; return Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2)) }))]; const hasCjk = terms.some(term => /[\u3400-\u9fff]/u.test(term)); const semanticAlpha = this.engine.fallback ? Math.min(alpha, 0.35) : alpha; const scored = chunks.map(chunk => { const semantic = Math.max(0, Math.min(1, (EmbeddingEngine.cosine(queryVector, chunk.embedding) + 1) / 2)); const haystack = `${chunk.content} ${chunk.filename}`.toLowerCase(); const lexicalHits = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0); const lexical = terms.length ? lexicalHits / terms.length : 0; const ftsBoost = fts.has(chunk.id) ? Math.min(1, Math.abs(Number(fts.get(chunk.id))) / 10) : 0; let score = semanticAlpha * semantic + (1 - semanticAlpha) * Math.max(lexical, ftsBoost); if (this.engine.fallback && ((hasCjk && lexicalHits < 2) || (!hasCjk && lexicalHits === 0))) score = Math.min(score, 0.2); if (rerank || settings.rerank) score = score * 0.75 + lexical * 0.25; return { ...chunk, semanticScore: semantic, lexicalScore: lexical, score } }).filter(item => item.score >= minScore).sort((a, b) => b.score - a.score).slice(0, k)
    const items = scored.map(item => ({ resourceId: item.documentId, uri: `moss-rag://resource/${encodeURIComponent(item.documentId)}?revision=${item.revision}`, id: item.documentId, chunkId: item.id, filename: item.filename, title: item.metadata.title || item.filename, source: item.sourcePath, content: item.content, snippet: item.content.slice(0, 600), score: Number(item.score.toFixed(4)), semanticScore: Number(item.semanticScore.toFixed(4)), lexicalScore: Number(item.lexicalScore.toFixed(4)), revision: item.revision, page: item.metadata.page || null, lineStart: item.metadata.lineStart || null, lineEnd: item.metadata.lineEnd || null }))
    return { query, items, accepted: items.length > 0, refusal: items.length ? null : (this.settings().refusal ? '没有找到足够相关的资料，暂不根据通用知识回答。' : null), diagnostics: { candidates: chunks.length, topK: k, threshold: minScore, hybridAlpha: alpha, rerank: Boolean(rerank || settings.rerank), engine: this.engine.status() } }
  }
  listJobs() { return { jobs: this.store.listJobs() } }
  getSettings() { return { settings: this.settings(), engine: this.engine.status() } }
  updateSettings(input = {}) { for (const key of ['embeddingModel','topK','threshold','hybridAlpha','rerank','refusal']) if (input[key] !== undefined) this.store.setSetting(key, input[key]); if (input.embeddingModel && input.embeddingModel !== this.engine.model) { this.engine.model = String(input.embeddingModel); this.engine.pipeline = null; this.engine.state = 'not-ready' } return this.getSettings() }
  async deleteDocument({ id, revision } = {}) { const doc = this.store.getDocument(id); if (!doc) throw new Error('文档不存在'); if (revision !== undefined && Number(revision) !== doc.revision) throw new Error('文档版本已变化，请重新读取后再删除'); const removed = this.store.deleteDocument(id); if (removed) { const file = path.join(this.documentsDir, removed.sourcePath); const relative = path.relative(this.documentsDir, file); if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) await fs.rm(path.dirname(file), { recursive: true, force: true }) } return { deleted: true, id } }
  resolveResource({ uri }) { const parsed = new URL(String(uri || '')); if (parsed.protocol !== 'moss-rag:' || parsed.hostname !== 'resource') throw new Error('无法识别资源引用'); const id = decodeURIComponent(parsed.pathname.replace(/^\//, '')); const doc = this.store.getDocument(id); if (!doc) throw new Error('资源不存在'); const requestedRevision = parsed.searchParams.get('revision'); if (requestedRevision && Number(requestedRevision) !== doc.revision) throw new Error('资源版本已变化，请重新检索'); const file = path.join(this.documentsDir, doc.sourcePath); return { kind: 'file', path: file, name: doc.filename, mimeType: doc.mime || 'text/plain', resourceId: doc.id, resourceUri: `moss-rag://resource/${encodeURIComponent(doc.id)}?revision=${doc.revision}`, revision: doc.revision } }
}
