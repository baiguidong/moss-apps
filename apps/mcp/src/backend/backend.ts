import { AppBackendClient, type AppActionContext } from '@moss/app-sdk'
import { METHODS, timeout, type Catalog, type Result } from '../contracts'

export function createMcpBackend(options: ConstructorParameters<typeof AppBackendClient>[0] = {}) {
  const backend = new AppBackendClient(options)
  for (const method of METHODS) backend.registerAction(method, async (input: unknown, context: AppActionContext): Promise<Result> => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('操作参数格式不正确。')
      const data = await backend.host.request<Catalog>('moss.mcp/v1', method, input as Record<string, unknown>, { signal: context.signal, timeoutMs: timeout(method) - 1000 })
      if (!Array.isArray(data?.servers)) throw new Error('服务列表格式不正确，请更新 Moss 后重试。')
      return { ok: true, data }
    } catch (cause) {
      const error = cause as { code?: string; message?: string }
      return { ok: false, error: { code: error.code, message: error.code === 'APP_HOST_UNAVAILABLE' ? '当前 Moss 尚不支持 MCP 管理，请升级后重试。' : error.message || '操作未完成，请重试。' } }
    }
  })
  return backend
}
