import fs from 'node:fs/promises'
import path from 'node:path'
import { AppBackendClient } from '@moss/app-sdk'

// One Host process, separate task stores/queues for each trusted session scope.
// The facade lets existing engines retain their per-store closures.
export function createSessionBackend(factory, { catalog } = {}) {
  const scopes = new Map(), closed = new Set()
  let context, manifest, stopping = false
  async function close(id) {
    closed.add(id)
    const pending = scopes.get(id)
    if (!pending) return
    const entry = await pending
    entry.controller.abort(new Error('会话已关闭'))
    await entry.options.onShutdown?.()
    await Promise.allSettled([...entry.active])
    scopes.delete(id)
  }
  async function initialize(storage) {
    if (stopping || closed.has(storage.sessionId)) throw new Error('会话已关闭')
    const root = await fs.realpath(storage.directory), workspace = await fs.realpath(storage.workspace)
    const relative = path.relative(workspace, root)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('任务目录不在会话工作区中')
    const entry = { actions: new Map(), active: new Set(), options: null, controller: new AbortController() }
    const host = { ...backend.host, request(protocol, method, input, options) {
      if (protocol === 'moss.artifacts/v1' && method === 'url.get') input = { ...input, sessionId: storage.sessionId }
      return backend.host.request(protocol, method, input, options)
    } }
    class ScopedClient {
      constructor(options) { entry.options = options; this.host = host }
      registerAction(name, handler) { entry.actions.set(name, handler) }
      emit(name, data) { if (!closed.has(storage.sessionId)) backend.emit(name, { ...data, sessionId: storage.sessionId }) }
      log(...args) { backend.log(...args) }
      start() {}
    }
    factory(ScopedClient)
    entry.context = { ...context, dataDir: root, cacheDir: context.dataDir, sessionId: storage.sessionId, workspace, host }
    await entry.options.onInitialize(entry.context)
    return entry
  }
  function decorate(value, sessionId, field = '') {
    if (typeof value === 'string') return !['resourceUri', 'resource_uri', 'displayMarkdown', 'uri'].includes(field) ? value : value.replace(/\bmoss-[a-z0-9-]+:\/\/(?:works|files)\/[a-zA-Z0-9_/-]+(?:\?session=[a-zA-Z0-9-]+)?/g, raw => {
      const uri = new URL(raw)
      if (!manifest.contributes?.resourceProviders?.some(provider => provider.schemes.includes(uri.protocol.slice(0, -1)))) return raw
      uri.searchParams.set('session', sessionId); return uri.href
    })
    if (Array.isArray(value)) return value.map(item => decorate(item, sessionId))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decorate(item, sessionId, key)]))
    return value
  }
  async function invoke(name, input, call) {
    const storage = call.source?.storage
    if (name === 'session.close') { if (storage) await close(storage.sessionId); return { closed: true } }
    if (!storage) {
      if (name === 'workspace.get') return { tasks: [], files: [], artifactUrlsDeferred: true }
      if (name === 'composer.list') return { items: [] }
      if (name === 'catalog.get' || name === 'engine.prepare') return catalog?.({ dataDir: context.dataDir, cacheDir: context.dataDir, prepare: name === 'engine.prepare' }) || {}
      if (['composer.resolve', 'resources.resolve'].includes(name) && input.intent === 'create') return {
        title: manifest.displayName, prompt: `请使用${manifest.displayName}创作。`, tools: manifest.contributes.tools.map(tool => tool.name || tool.id),
        instruction: '读取此 App 的 Skill，在当前会话调用创作工具。完成后用 moss_present 展示结果，并使用 result.displayMarkdown 回复。',
      }
      throw new Error('请在会话中调用创作工具')
    }
    if (stopping || closed.has(storage.sessionId)) throw new Error('会话已关闭')
    if (!scopes.has(storage.sessionId)) {
      const pending = initialize(storage).catch(error => { scopes.delete(storage.sessionId); throw error })
      scopes.set(storage.sessionId, pending)
    }
    const entry = await scopes.get(storage.sessionId)
    if (stopping || closed.has(storage.sessionId)) throw new Error('会话已关闭')
    if (entry.context.dataDir !== storage.directory) throw new Error('会话存储目录已改变')
    const handler = entry.actions.get(name)
    if (!handler) throw new Error(`未注册的会话操作：${name}`)
    const task = Promise.resolve().then(() => handler(input, { ...call, ...entry.context, source: call.source, signal: call.signal ? AbortSignal.any([call.signal, entry.controller.signal]) : entry.controller.signal }))
    entry.active.add(task)
    try { return decorate(await task, storage.sessionId) }
    finally { entry.active.delete(task) }
  }
  const backend = new AppBackendClient({
    async onInitialize(ctx) {
      context = ctx
      manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), 'app.moss.json'), 'utf8'))
      for (const action of manifest.backend.actions) backend.registerAction(action.name, (input, call) => invoke(action.name, input, call))
      const pending = await backend.host.request('moss.session-storage/v1', 'scopes.pending', {})
      for (const storage of pending) {
        const entry = initialize(storage)
        scopes.set(storage.sessionId, entry)
        await entry
      }
    },
    async onShutdown() { stopping = true; await Promise.all([...scopes.keys()].map(close)) },
  })
  backend.start()
  return backend
}
