import { AppBackendClient } from '@moss/app-sdk'
import { createMcpClient, type McpHostInputMap } from '@moss/app-sdk/mcp'
import { METHODS, SERVICE, DEFAULT_SETTINGS, validateSettings, type Method, type Settings, type Preparation, type Result } from '../contracts'
import { serviceConfig, settingsFromConfig } from './builtin-config'
import { resolveSettings } from '../server/settings'

export function createServiceBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  let initialized = false, closing = false, setup: Promise<void> | undefined
  let settings: Settings = structuredClone(DEFAULT_SETTINGS)
  let preparation: Preparation = { state: 'configuring' }
  let inspection: { controller: AbortController; promise: Promise<void> } | undefined
  let mutation = Promise.resolve()
  const read = (method: Method, input: Record<string, unknown> = {}, signal?: AbortSignal, timeoutMs = 60_000) =>
    createMcpClient(backend.host).request(method, input as McpHostInputMap[typeof method], { signal, timeoutMs })
  const setPreparation = (next: Preparation) => {
    preparation = next
    if (next.state === 'failed') backend.log('error', next.error || 'MCP connection failed')
    if (!closing) backend.emit('service.changed', next)
  }
  const clearInspection = (controller: AbortController) => { if (inspection?.controller === controller) inspection = undefined }
  const ensureRegistered = () => {
    if (initialized) return Promise.resolve()
    return setup ??= (async () => {
      const existing = (await read('servers.list', {}, undefined, 3000)).servers.find(server => server.name === SERVICE)
      if (existing) {
        settings = settingsFromConfig(existing.config)
        settings = await resolveSettings(settings)
        const config = serviceConfig(settings)
        if (!existing.enabled || JSON.stringify(config) !== JSON.stringify(existing.config)) {
          await read('servers.save', { name: SERVICE, previousName: SERVICE, enabled: true, config }, undefined, 3000)
        }
      } else {
        await read('servers.save', { name: SERVICE, enabled: true, config: serviceConfig(settings) }, undefined, 3000)
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
        const catalog = await read('servers.inspect', { name: SERVICE }, controller.signal)
        if (controller.signal.aborted || closing) return
        const check = catalog.servers.find(server => server.name === SERVICE)?.check
        setPreparation(check?.state === 'connected' ? { state: 'ready' }
          : { state: 'failed', error: check?.error || '连接检查未完成，请重试。' })
      } catch (cause) {
        if (!controller.signal.aborted && !closing) setPreparation({ state: 'failed', error: cause instanceof Error ? cause.message : '连接失败，请重试。' })
      } finally { clearInspection(controller) }
    })()
    inspection = { controller, promise }
  }
  const backend = new AppBackendClient({ ...options,
    onInitialize: async (context: unknown) => {
      if (typeof options.onInitialize === 'function') await options.onInitialize(context)
      setImmediate(beginInspection)
    },
    onShutdown: async (context: unknown) => {
      closing = true; inspection?.controller.abort()
      if (typeof options.onShutdown === 'function') await options.onShutdown(context)
    },
  })
  for (const method of METHODS) backend.registerAction(method, async (raw, context): Promise<Result> => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('操作参数格式不正确。')
      if (method !== 'servers.save' && Object.keys(raw).length) throw new Error('此操作不接受额外参数。')
      if (method === 'servers.save') {
        const input = validateSettings(raw)
        const pending = mutation.then(async () => {
          // Validate before canceling the live connection; invalid settings preserve it.
          const next = await resolveSettings(input)
          const previous = inspection
          previous?.controller.abort(); await previous?.promise
          if (closing || context.signal.aborted) throw new Error('操作已取消。')
          const existing = (await read('servers.list', {}, context.signal)).servers.find(server => server.name === SERVICE)
          try {
            await read('servers.save', { name: SERVICE, ...(existing ? { previousName: SERVICE } : {}), enabled: true, config: serviceConfig(next) }, context.signal)
            settings = next; initialized = true
          } catch (error) { initialized = false; beginInspection(); throw error }
          beginInspection()
        })
        mutation = pending.catch(() => {}); await pending
      } else if (method === 'servers.inspect') { await mutation; beginInspection() }
      const catalog = await read('servers.list', {}, context.signal)
      return { ok: true, data: { ...catalog, servers: catalog.servers.filter(server => server.name === SERVICE), preparation: { ...preparation }, settings: structuredClone(settings) } }
    } catch (cause) {
      const error = cause as { code?: string; message?: string }
      return { ok: false, error: { code: error.code, message: error.message || '操作失败，请重试。' } }
    }
  })
  return backend
}
