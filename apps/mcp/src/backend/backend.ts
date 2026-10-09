import { createMcpClient, type McpHostInputMap } from '@moss/app-sdk/mcp'
import { AppBackendClient, type AppActionContext } from '@moss/app-sdk'
import { METHODS, timeout, type Catalog, type Method, type McpConfig, type Result } from '../contracts'
import { isBuiltin, validateBuiltinAction, withBuiltins } from '../builtins'
import { builtinServers, useBundledPlaywright } from './builtin-config'

export function createMcpBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  let initialized = false, initializing: Promise<void> | undefined
  const readCatalog = async (method: Method, input: Record<string, unknown>, requestOptions: { signal?: AbortSignal; timeoutMs: number }) => {
    const data = await createMcpClient(backend.host).request(method, input as McpHostInputMap[typeof method], requestOptions)
    if (!Array.isArray(data?.servers)) throw new Error('服务列表格式不正确，请更新 Moss 后重试。')
    return data
  }
  const ensureBuiltins = () => {
    if (initialized) return Promise.resolve()
    return initializing ??= (async () => {
      // Stay within the Backend handshake deadline; retry on the next list if Host is unavailable.
      const requestOptions = { timeoutMs: 3000 }
      const { capabilities } = await backend.host.request('moss.host/v1', 'capabilities.get', { protocols: ['moss.mcp/v1'] }, requestOptions)
      const save = capabilities.find(item => item.method === 'servers.save')
      if (!save?.supported || !save.allowed || !save.available) throw Object.assign(new Error('MCP 配置能力不可用或尚未授权'), { code: save?.allowed ? 'APP_HOST_UNAVAILABLE' : 'APP_PERMISSION_DENIED' })
      let catalog = await readCatalog('servers.list', {}, requestOptions)
      for (const server of builtinServers) {
        const existing = catalog.servers.find(item => item.name === server.name)
        if (existing) {
          const config = useBundledPlaywright(existing.config)
          if (JSON.stringify(config) !== JSON.stringify(existing.config)) {
            catalog = await readCatalog('servers.save', { name: existing.name, previousName: existing.name, enabled: existing.enabled, config }, requestOptions)
          }
          continue
        }
        try { catalog = await readCatalog('servers.save', structuredClone(server), requestOptions) }
        catch (error) {
          // A concurrent save (or a timed-out successful commit) must never overwrite user settings.
          catalog = await readCatalog('servers.list', {}, requestOptions)
          if (!catalog.servers.some(item => item.name === server.name)) throw error
        }
      }
      initialized = true
    })().finally(() => { initializing = undefined })
  }
  const backend = new AppBackendClient({ ...options, onInitialize: async (context: unknown) => {
    if (typeof options.onInitialize === 'function') await options.onInitialize(context)
    try { await ensureBuiltins() }
    catch { backend.log('warn', '内置 MCP 服务尚未完成配置，将在读取服务列表时重试。') }
  } })
  for (const method of METHODS) backend.registerAction(method, async (input: unknown, context: AppActionContext): Promise<Result> => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('操作参数格式不正确。')
      validateBuiltinAction(method, input)
      let setupError: string | undefined
      if (method === 'servers.list') {
        try { await ensureBuiltins() }
        catch (error) { setupError = `内置服务配置未完成：${error instanceof Error ? error.message : '请重试。'}` }
      }
      let hostInput = input as Record<string, unknown>
      if (method === 'servers.save' && isBuiltin(hostInput.name as string) && hostInput.config) {
        hostInput = { ...hostInput, config: useBundledPlaywright(hostInput.config as McpConfig) }
      }
      const data = await readCatalog(method, hostInput, { signal: context.signal, timeoutMs: timeout(method) - 1000 })
      return { ok: true, data: { ...withBuiltins(data), ...(setupError ? { setupError } : {}) } }
    } catch (cause) {
      const error = cause as { code?: string; message?: string }
      return { ok: false, error: { code: error.code, message: error.code === 'APP_HOST_UNAVAILABLE' ? '当前 Moss 尚不支持 MCP 管理，请升级后重试。' : error.message || '操作未完成，请重试。' } }
    }
  })
  return backend
}
