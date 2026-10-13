import { isAbsolute, join } from 'node:path'
import { AppBackendClient } from '@moss/app-sdk'
import { createMcpClient, type McpHostInputMap } from '@moss/app-sdk/mcp'
import { METHODS, MEMORY, validateSettings, type Method, type Preparation, type Result } from '../contracts'
import { memoryConfig } from './builtin-config'
import { readMemoryGraph } from './graph'
import type { GraphResult } from '../contracts'

export function createMemoryBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  let initialized = false, closing = false, setup: Promise<void> | undefined, memoryFile = ''
  let preparation: Preparation = { state: 'configuring' }
  let inspection: { controller: AbortController; promise: Promise<void> } | undefined
  let mutation = Promise.resolve()
  const read = (method: Method, input: Record<string, unknown> = {}, signal?: AbortSignal, timeoutMs = 60_000) =>
    createMcpClient(backend.host).request(method, input as McpHostInputMap[typeof method], { signal, timeoutMs })
  const setPreparation = (next: Preparation) => {
    preparation = next
    if (next.state === 'failed') backend.log('error', next.error || 'MCP connection failed')
    if (!closing) backend.emit('memory.changed', next)
  }
  const clearInspection = (controller: AbortController) => {
    if (inspection?.controller === controller) inspection = undefined
  }
  const ensureRegistered = () => {
    if (initialized) return Promise.resolve()
    return setup ??= (async () => {
      if (!memoryFile) throw new Error('未获得 App 数据目录，请重启记忆 App。')
      const existing = (await read('servers.list', {}, undefined, 3000)).servers.find(server => server.name === MEMORY)
      const config = memoryConfig(memoryFile, existing?.config.disabledTools)
      if (!existing || !existing.enabled || JSON.stringify(config) !== JSON.stringify(existing.config)) {
        try {
          await read('servers.save', { name: MEMORY, ...(existing ? { previousName: MEMORY } : {}), enabled: true, config }, undefined, 3000)
        } catch (error) {
          // A create may have succeeded before a Host timeout. Preserve that record.
          if (existing || !(await read('servers.list', {}, undefined, 3000)).servers.some(server => server.name === MEMORY)) throw error
        }
      }
      initialized = true
    })().finally(() => { setup = undefined })
  }
  const beginInspection = () => {
    if (closing || inspection) return
    const controller = new AbortController()
    setPreparation({ state: initialized ? 'connecting' : 'configuring' })
    const promise = (async () => {
      try {
        await ensureRegistered()
        if (controller.signal.aborted || closing) return
        setPreparation({ state: 'connecting' })
        const catalog = await read('servers.inspect', { name: MEMORY }, controller.signal)
        if (controller.signal.aborted || closing) return
        const check = catalog.servers.find(server => server.name === MEMORY)?.check
        setPreparation(check?.state === 'connected' ? { state: 'ready' }
          : { state: 'failed', error: check?.error || '记忆服务检查未完成，请重试。' })
      } catch (cause) {
        if (!controller.signal.aborted && !closing) setPreparation({ state: 'failed', error: cause instanceof Error ? cause.message : '记忆服务连接失败，请重试。' })
      } finally {
        clearInspection(controller)
      }
    })()
    inspection = { controller, promise }
  }
  const backend = new AppBackendClient({ ...options,
    onInitialize: async (context: { dataDir?: string }) => {
      if (typeof options.onInitialize === 'function') await options.onInitialize(context)
      if (typeof context.dataDir === 'string' && isAbsolute(context.dataDir)) memoryFile = join(context.dataDir, 'memory', 'knowledge-graph.jsonl')
      // Registration and disk checks must not delay the SDK's service.ready handshake.
      setImmediate(beginInspection)
    },
    onShutdown: async (context: unknown) => {
      closing = true
      inspection?.controller.abort()
      if (typeof options.onShutdown === 'function') await options.onShutdown(context)
    },
  })
  for (const method of METHODS) backend.registerAction(method, async (raw, context): Promise<Result> => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('操作参数格式不正确。')
      if (method !== 'servers.save' && Object.keys(raw).length) throw new Error('此操作不接受额外参数。')
      if (method === 'servers.save') {
        const settings = validateSettings(raw)
        const pending = mutation.then(async () => {
          const previous = inspection
          previous?.controller.abort()
          await previous?.promise
          if (closing || context.signal.aborted) throw new Error('操作已取消。')
          await ensureRegistered()
          await read('servers.save', { name: MEMORY, previousName: MEMORY, enabled: true, config: memoryConfig(memoryFile, settings.disabledTools) }, context.signal)
          beginInspection()
        })
        mutation = pending.catch(() => {})
        await pending
      } else if (method === 'servers.inspect') {
        await mutation
        beginInspection()
      }
      const catalog = await read('servers.list', {}, context.signal)
      return { ok: true, data: { ...catalog, servers: catalog.servers.filter(server => server.name === MEMORY), preparation: { ...preparation }, memoryFile } }
    } catch (cause) {
      const error = cause as { code?: string; message?: string }
      return { ok: false, error: { code: error.code, message: error.message || '操作失败，请重试。' } }
    }
  })
  backend.registerAction('graph.read', async (raw, context): Promise<GraphResult> => {
    try { return { ok: true, data: await readMemoryGraph(memoryFile, raw, context.signal) } }
    catch (cause) { return { ok: false, error: { message: cause instanceof Error ? cause.message : '读取记忆图谱失败，请刷新重试。' } } }
  })
  return backend
}
