import { AppBackendClient } from '@moss/app-sdk'
import { createMcpClient, type McpHostInputMap } from '@moss/app-sdk/mcp'
import { METHODS, THINKING, type Method, type Preparation, type Result } from '../contracts'
import { thinkingConfig } from './builtin-config'

export function createThinkingBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  let initialized = false, closing = false, setup: Promise<void> | undefined
  let preparation: Preparation = { state: 'configuring' }
  let inspection: { controller: AbortController; promise: Promise<void> } | undefined
  const read = (method: Method | 'servers.save', input: Record<string, unknown> = {}, signal?: AbortSignal, timeoutMs = 60_000) =>
    createMcpClient(backend.host).request(method, input as McpHostInputMap[typeof method], { signal, timeoutMs })
  const setPreparation = (next: Preparation) => {
    preparation = next
    if (next.state === 'failed') backend.log('error', next.error || 'MCP connection failed')
    if (!closing) backend.emit('thinking.changed', next)
  }
  const clearInspection = (controller: AbortController) => {
    if (inspection?.controller === controller) inspection = undefined
  }
  const ensureRegistered = () => {
    if (initialized) return Promise.resolve()
    return setup ??= (async () => {
      const existing = (await read('servers.list', {}, undefined, 3000)).servers.find(server => server.name === THINKING)
      const config = thinkingConfig()
      if (!existing || !existing.enabled || JSON.stringify(config) !== JSON.stringify(existing.config)) {
        try {
          await read('servers.save', { name: THINKING, ...(existing ? { previousName: THINKING } : {}), enabled: true, config }, undefined, 3000)
        } catch (error) {
          // A create may have succeeded before a Host timeout. Preserve that record.
          if (existing || !(await read('servers.list', {}, undefined, 3000)).servers.some(server => server.name === THINKING)) throw error
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
        const catalog = await read('servers.inspect', { name: THINKING }, controller.signal)
        if (controller.signal.aborted || closing) return
        const check = catalog.servers.find(server => server.name === THINKING)?.check
        setPreparation(check?.state === 'connected' ? { state: 'ready' }
          : { state: 'failed', error: check?.error || '分步思考服务检查未完成，请重试。' })
      } catch (cause) {
        if (!controller.signal.aborted && !closing) setPreparation({ state: 'failed', error: cause instanceof Error ? cause.message : '分步思考服务连接失败，请重试。' })
      } finally {
        clearInspection(controller)
      }
    })()
    inspection = { controller, promise }
  }
  const backend = new AppBackendClient({ ...options,
    onInitialize: async (context: unknown) => {
      if (typeof options.onInitialize === 'function') await options.onInitialize(context)
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
      if (Object.keys(raw).length) throw new Error('此操作不接受额外参数。')
      if (method === 'servers.inspect') beginInspection()
      const catalog = await read('servers.list', {}, context.signal)
      return { ok: true, data: { ...catalog, servers: catalog.servers.filter(server => server.name === THINKING), preparation: { ...preparation } } }
    } catch (cause) {
      const error = cause as { code?: string; message?: string }
      return { ok: false, error: { code: error.code, message: error.message || '操作失败，请重试。' } }
    }
  })
  return backend
}
