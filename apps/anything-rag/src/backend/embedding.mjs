import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

function normalize(vector) { const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1; return vector.map(value => value / norm) }
function fallbackVector(text, size = 256) {
  const vector = new Array(size).fill(0), value = String(text || '').toLowerCase()
  for (let i = 0; i < value.length; i++) { const code = value.codePointAt(i) || 0; vector[code % size] += 1; if (i + 1 < value.length) vector[(code * 31 + (value.codePointAt(i + 1) || 0)) % size] += 0.6 }
  return normalize(vector)
}
function abortError(signal) { return signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('操作已取消'), { name: 'AbortError' }) }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(signal) }
async function abortable(promise, signal) {
  throwIfAborted(signal)
  if (!signal) return promise
  let onAbort
  try { return await Promise.race([promise, new Promise((_, reject) => { onAbort = () => reject(abortError(signal)); signal.addEventListener('abort', onAbort, { once: true }) })]) }
  finally { if (onAbort) signal.removeEventListener('abort', onAbort) }
}

export const EMBEDDING_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'

export class EmbeddingEngine {
  constructor({ dataDir, bundledModelDir = null, disableNative = false, model = process.env.MOSS_RAG_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small', revision = process.env.MOSS_RAG_EMBEDDING_REVISION || EMBEDDING_MODEL_REVISION, onChanged = () => {} } = {}) {
    this.dataDir = dataDir; this.bundledModelDir = bundledModelDir; this.disableNative = disableNative; this.model = model; this.revision = revision; this.onChanged = onChanged; this.state = 'not-ready'; this.error = null; this.pipeline = null; this.transformers = null; this.fallback = false; this.modelDir = path.join(dataDir, 'models')
  }
  modelPath(root = this.modelDir) { return path.join(root, this.model) }
  bundledPath() { return this.bundledModelDir ? this.modelPath(this.bundledModelDir) : null }
  modelFiles(root = this.modelDir) { const directory = this.modelPath(root); return { directory, onnx: path.join(directory, 'onnx', 'model_quantized.onnx') } }
  ensureBundledModel() {
    const source = this.bundledPath(), target = this.modelPath()
    if (!source || !fs.existsSync(path.join(source, 'onnx', 'model_quantized.onnx')) || fs.existsSync(this.modelFiles().onnx)) return false
    fs.mkdirSync(this.modelDir, { recursive: true })
    fs.cpSync(source, target, { recursive: true })
    return true
  }
  status() {
    const bundled = Boolean(this.bundledPath() && fs.existsSync(this.modelFiles(this.bundledModelDir).onnx))
    return { state: this.state, model: this.model, revision: this.revision, fallback: this.fallback, native: !this.fallback && this.state === 'ready', error: this.error, cacheDir: this.modelDir, bundled, sourceUrl: `https://huggingface.co/${this.model}/tree/${this.revision}`, dimension: this.fallback ? 256 : 384 }
  }
  async prepare({ allowDownload = true, force = false, signal } = {}) {
    throwIfAborted(signal)
    if (this.state === 'ready' && !force) return this.status()
    if (force) { this.pipeline = null; this.fallback = false; this.state = 'not-ready' }
    this.state = 'preparing'; this.error = null; this.onChanged(this.status())
    try {
      if (this.disableNative || process.env.MOSS_RAG_DISABLE_NATIVE === '1') throw new Error('测试环境已禁用 native embedding')
      fs.mkdirSync(this.modelDir, { recursive: true })
      const modulePath = process.env.MOSS_RAG_RUNTIME_MODULES
        ? createRequire(path.join(process.env.MOSS_RAG_RUNTIME_MODULES, 'package.json')).resolve('@xenova/transformers')
        : '@xenova/transformers'
      const mod = await abortable(import(modulePath), signal)
      this.transformers = mod
      mod.env.cacheDir = this.modelDir
      this.ensureBundledModel()
      if (!allowDownload && !fs.existsSync(this.modelFiles().directory)) throw new Error('本地 embedding 模型尚未下载')
      const options = { quantized: true, cache_dir: this.modelDir }
      if (this.model === 'Xenova/multilingual-e5-small' && this.revision) options.revision = this.revision
      if (fs.existsSync(path.join(this.modelDir, this.model, 'onnx/model_quantized.onnx'))) {
        mod.env.localModelPath = this.modelDir
        options.local_files_only = true
      }
      this.pipeline = await abortable(mod.pipeline('feature-extraction', this.model, options), signal)
      this.fallback = false; this.state = 'ready'; this.onChanged(this.status()); return this.status()
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        this.pipeline = null; this.state = 'not-ready'; this.error = '操作已取消'; this.onChanged(this.status()); throw error
      }
      this.error = error instanceof Error ? error.message : String(error)
      this.pipeline = null; this.fallback = true; this.state = 'ready'; this.onChanged(this.status()); return this.status()
    }
  }
  async retry() { return this.prepare({ allowDownload: true, force: true }) }
  async embed(texts, kind = 'passage', { signal } = {}) {
    throwIfAborted(signal)
    if (this.state !== 'ready') await this.prepare({ allowDownload: true, signal })
    const values = Array.isArray(texts) ? texts : [texts], prefix = kind === 'query' ? 'query: ' : 'passage: '
    if (!this.pipeline) { return values.map(value => { throwIfAborted(signal); return fallbackVector(`${prefix}${value}`) }) }
    const output = []
    for (const value of values) {
      throwIfAborted(signal)
      const tensor = await abortable(this.pipeline(`${prefix}${value}`, { pooling: 'mean', normalize: true }), signal)
      throwIfAborted(signal)
      output.push(tensor.tolist().flat())
    }
    return output
  }
  static cosine(a, b) { if (!a?.length || !b?.length || a.length !== b.length) return 0; let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum }
}
