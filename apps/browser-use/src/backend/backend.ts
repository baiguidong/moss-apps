import { AppBackendClient } from '@moss/app-sdk'
import { createMcpClient, type McpHostInputMap } from '@moss/app-sdk/mcp'
import { METHODS, type Method, type Preparation, type Result, type SaveInput } from '../contracts'
import { DEFAULT_CONFIG, PLAYWRIGHT_CDP, browserArgs, browserFields, configFromFields, migrateLegacyBrowserConfig, type BrowserFields } from '../browser-config'
import { useBundledPlaywright } from './builtin-config'
import { createRequire } from 'node:module'
const loadRuntime = createRequire(import.meta.url)
const prepareManagedBrowser = (options: { signal: AbortSignal }): Promise<string> => loadRuntime('../playwright-cdp/managed.cjs').prepareManagedBrowser(options)

export function createBrowserBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}, dependencies = { prepareManagedBrowser }) {
  let initialized = false, closing = false, setup: Promise<void> | undefined
  let preparation: Preparation = { state: 'configuring' }
  let inspection: { controller: AbortController; promise: Promise<void> } | undefined
  let mutation = Promise.resolve()
  const read = (method: Method, input: Record<string, unknown> = {}, signal?: AbortSignal, timeoutMs = 60_000) =>
    createMcpClient(backend.host).request(method, input as McpHostInputMap[typeof method], { signal, timeoutMs })
  const setPreparation = (next: Preparation) => {
    preparation = next
    if (!closing) backend.emit('browser.changed', next)
  }
  const clearInspection = (controller: AbortController) => {
    if (inspection?.controller === controller) inspection = undefined
  }
  const ensureRegistered = () => {
    if (initialized) return Promise.resolve()
    return setup ??= (async () => {
      const catalog = await read('servers.list', {}, undefined, 3000)
      const existing = catalog.servers.find(server => server.name === PLAYWRIGHT_CDP)
      const config = useBundledPlaywright(existing ? migrateLegacyBrowserConfig(existing.config) : DEFAULT_CONFIG)
      if (!existing || JSON.stringify(config) !== JSON.stringify(existing.config)) {
        try {
          await read('servers.save', { name: PLAYWRIGHT_CDP, ...(existing ? { previousName: PLAYWRIGHT_CDP } : {}), enabled: existing?.enabled ?? true, config }, undefined, 3000)
        } catch (error) {
          // A timed-out successful create must never overwrite the persisted configuration.
          if (existing || !(await read('servers.list', {}, undefined, 3000)).servers.some(server => server.name === PLAYWRIGHT_CDP)) throw error
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
        const registered = await read('servers.list', {}, controller.signal)
        const config = registered.servers.find(server => server.name === PLAYWRIGHT_CDP)?.config
        if (config && browserArgs(config).includes('--moss-managed-browser')) {
          setPreparation({ state: 'preparing' })
          await dependencies.prepareManagedBrowser({ signal: controller.signal })
          if (controller.signal.aborted || closing) return
        }
        setPreparation({ state: 'connecting' })
        const catalog = await read('servers.inspect', { name: PLAYWRIGHT_CDP }, controller.signal)
        if (controller.signal.aborted || closing) return
        const check = catalog.servers.find(server => server.name === PLAYWRIGHT_CDP)?.check
        setPreparation(check?.state === 'connected' ? { state: 'ready' }
          : { state: 'failed', error: check?.error || '浏览器连接检查未完成，请重试。' })
      } catch (cause) {
        if (!controller.signal.aborted && !closing) setPreparation({ state: 'failed', error: cause instanceof Error ? cause.message : '浏览器连接失败，请重试。' })
      } finally {
        clearInspection(controller)
      }
    })()
    inspection = { controller, promise }
  }
  const backend = new AppBackendClient({ ...options,
    onInitialize: async (context: unknown) => {
      if (typeof options.onInitialize === 'function') await options.onInitialize(context)
      try { await ensureRegistered() }
      catch { /* A later explicit read/check retries registration and reports errors. */ }
      // Registration reads persisted configuration only. Viewing settings and
      // starting Moss must never prepare or inspect the MCP/browser service.
      preparation = { state: 'idle' }
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
      const input = raw as Partial<SaveInput>
      if (method !== 'servers.list' && input.name !== PLAYWRIGHT_CDP) throw new Error('只能管理此 App 的浏览器连接。')
      if (method === 'servers.save') {
        if (input.previousName !== PLAYWRIGHT_CDP || input.enabled !== true || !input.config) throw new Error('请通过 App 管理启停网页操控，连接名称固定。')
        const pending = mutation.then(async () => {
          const previous = inspection
          previous?.controller.abort()
          await previous?.promise
          await ensureRegistered()
          await read('servers.save', { ...input, config: useBundledPlaywright(input.config!) }, context.signal)
          setPreparation({ state: 'idle' })
        })
        mutation = pending.catch(() => {})
        await pending
      } else if (method === 'servers.inspect') beginInspection()
      return { ok: true, data: { ...await read('servers.list', {}, context.signal), preparation: { ...preparation } } }
    } catch (cause) {
      const error = cause as { code?: string; message?: string }
      return { ok: false, error: { code: error.code, message: error.message || '操作失败，请重试。' } }
    }
  })
  const readSettings = async () => {
    await ensureRegistered()
    const server = (await read('servers.list')).servers.find(server => server.name === PLAYWRIGHT_CDP)!
    const fields = browserFields(server.config)
    return { values: { mode: fields.mode, outputDirectory: fields['--output-dir'], extraArguments: fields.extra,
      managedEndpoint: fields.mode === 'managed' ? fields['--cdp-endpoint'] : '', cdpEndpoint: fields.mode === 'cdp' ? fields['--cdp-endpoint'] : '',
      executablePath: fields['--executable-path'], userDataDirectory: fields['--user-data-dir'], profileDirectory: fields['--profile-dir-name'] },
      configuredFields: Object.hasOwn(server.config.env || {}, 'PLAYWRIGHT_MCP_EXTENSION_TOKEN') ? ['extensionToken'] : [] }
  }
  backend.registerAction('settings.read', readSettings)
  backend.registerAction('settings.save', async (raw, context) => {
    const values = raw as Record<string, string>
    const pending = mutation.then(async () => {
      const previous = inspection
      previous?.controller.abort(); await previous?.promise
      await ensureRegistered()
      const server = (await read('servers.list', {}, context.signal)).servers.find(server => server.name === PLAYWRIGHT_CDP)!
      const fields: BrowserFields = { mode: values.mode as BrowserFields['mode'], '--output-dir': values.outputDirectory || '',
        '--cdp-endpoint': (values.mode === 'managed' ? values.managedEndpoint : values.mode === 'cdp' ? values.cdpEndpoint : '') || '',
        '--executable-path': values.executablePath || '', '--user-data-dir': values.userDataDirectory || '', '--profile-dir-name': values.profileDirectory || '',
        extensionToken: values.extensionToken || '', extra: values.extraArguments || '' }
      const config = useBundledPlaywright(configFromFields(server.config, fields, server.config.disabledTools?.join('\n') || ''))
      const before = browserFields(server.config)
      const unchanged = (Object.keys(fields) as Array<keyof BrowserFields>).every(key => fields[key] === before[key])
      if (!unchanged) await read('servers.save', { name: PLAYWRIGHT_CDP, previousName: PLAYWRIGHT_CDP, enabled: server.enabled, config }, context.signal)
      setPreparation({ state: 'idle' })
    })
    mutation = pending.catch(() => {})
    await pending
    return readSettings()
  })
  return backend
}
