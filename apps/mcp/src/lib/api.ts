import { createAppClient } from '@moss/app-sdk/ui'
import { createMcpClient, type McpHostInputMap } from '@moss/app-sdk/mcp'
import type { AppUiApi } from '@moss/app-sdk'
import { timeout, type Catalog, type Input, type Method } from '../contracts'
import { demoRequest } from './demo'
declare global { interface Window { mossApp?: AppUiApi } }
let client: ReturnType<typeof createAppClient> | undefined
export async function request(method: Method, input: Input = {}, signal?: AbortSignal): Promise<Catalog> {
  if (!window.mossApp) return demoRequest(method, input)
  client ??= createAppClient(window.mossApp)
  return createMcpClient(client.host).request(method, input as McpHostInputMap[Method], { signal, timeoutMs: timeout(method) }) as Promise<Catalog>
}
export function cancelRequests() { client?.dispose(); client = undefined }
export async function runtimeStatus(): Promise<{ state: string; label: string }> {
  if (!window.mossApp) return { state: 'demo', label: '演示模式' }
  const installation = await window.mossApp.app.getInstallationState()
  if ((installation?.installation as { enabled?: boolean })?.enabled === false) return { state: 'disabled', label: '应用已停用' }
  client ??= createAppClient(window.mossApp)
  const { capabilities } = await client.host.request('moss.host/v1', 'capabilities.get', { protocols: ['moss.mcp/v1'] })
  const capability = capabilities.find(item => item.protocol === 'moss.mcp/v1' && item.method === 'servers.list')
  return capability?.available ? { state: 'running', label: 'MCP 管理可用' } : { state: 'error', label: capability?.reason === 'permission_denied' ? 'MCP 管理未获授权' : 'MCP 管理暂不可用' }
}
