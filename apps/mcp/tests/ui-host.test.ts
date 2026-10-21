import { expect, test } from 'bun:test'
import { cancelRequests, request, runtimeStatus } from '../src/lib/api'

test('MCP UI calls the Host directly and reports capability availability', async () => {
  const calls: string[] = []
  ;(globalThis as any).window = { mossApp: {
    app: { getInstallationState: async () => ({ installation: { enabled: true } }) },
    host: {
      request: async (protocol: string, method: string) => {
        calls.push(`${protocol}:${method}`)
        return { ok: true, result: method === 'capabilities.get'
          ? { capabilities: [{ protocol: 'moss.mcp/v1', method: 'servers.list', available: true }] }
          : { servers: [] } }
      },
      cancel: async () => ({}), onEvent: () => () => {}, unsubscribe: async () => ({}), subscribe: async () => ({ ok: true, result: {} }),
    },
  } }
  try {
    expect(await request('servers.list')).toEqual({ servers: [] })
    expect(await runtimeStatus()).toEqual({ state: 'running', label: 'MCP 管理可用' })
    expect(calls).toEqual(['moss.mcp/v1:servers.list', 'moss.host/v1:capabilities.get'])
  } finally { cancelRequests(); delete (globalThis as any).window }
})
