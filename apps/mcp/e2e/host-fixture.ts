import type { Page } from '@playwright/test'
import type { Input, McpServer, Method, Tool } from '../src/contracts'

/** Controlled Host responses for UI states; never installed in the App bundle. */
export async function installHostFixture(page: Page, options: { holdInitialList?: boolean; failInitialList?: boolean; servers?: McpServer[]; inspectError?: string; holdInspection?: boolean; tools?: Tool[] } = {}) {
  let servers: McpServer[] = structuredClone(options.servers || [])
  let inspectError = options.inspectError
  let failList = Boolean(options.failInitialList)
  let releaseList = () => {}
  let releaseInspection = () => {}
  const calls: Method[] = []
  const requests: { method: Method; input: Input }[] = []
  const viewStates: { dirty: boolean; busy: boolean }[] = []
  let cancellations = 0
  let completedInspections = 0
  const inspection = options.holdInspection ? new Promise<void>(resolve => { releaseInspection = resolve }) : Promise.resolve()
  const initialList = options.holdInitialList ? new Promise<void>(resolve => { releaseList = resolve }) : Promise.resolve()
  await page.exposeFunction('mcpFixtureInvoke', async (method: Method, input: Input = {}) => {
    calls.push(method)
    requests.push({ method, input: structuredClone(input) })
    if (method === 'servers.list') {
      await initialList
      if (failList) {
        failList = false
        return { ok: false, error: { code: 'FIXTURE_FAILURE', message: '无法读取连接，请重试。' } }
      }
    } else if (method === 'servers.save') {
      servers = servers.filter(server => server.name !== input.previousName)
      servers.push({ name: input.name!, config: input.config!, enabled: input.enabled!, updatedAt: Date.now() })
    } else if (method === 'servers.inspect') {
      const snapshot = structuredClone(servers)
      const server = snapshot.find(server => server.name === input.name)
      await inspection
      completedInspections++
      if (server) {
        server.check = inspectError ? { state: 'failed', error: inspectError, tools: [], checkedAt: Date.now() } : { state: 'connected', tools: (options.tools || []).map(tool => ({ ...tool, disabled: server.config.disabledTools?.includes(tool.name) || tool.disabled })), checkedAt: Date.now() }
        const current = servers.find(item => item.name === server.name)
        if (current?.updatedAt === server.updatedAt && current?.enabled === server.enabled) current.check = server.check
      }
      return { servers: snapshot }
    } else if (method === 'servers.set-enabled') {
      servers = servers.map(server => server.name === input.name ? { ...server, enabled: input.enabled!, updatedAt: Date.now(), check: null } : server)
    } else if (method === 'servers.remove') {
      servers = servers.filter(server => server.name !== input.name)
    } else if (method === 'auth.start' || method === 'auth.clear') {
      const server = servers.find(server => server.name === input.name)
      if (server) server.check = method === 'auth.start' ? { state: 'authorized', tools: [], checkedAt: Date.now() } : null
    }
    return { servers }
  })
  await page.exposeFunction('mcpFixtureCancel', () => { cancellations++ })
  await page.exposeFunction('mcpFixtureViewState', (state: { dirty: boolean; busy: boolean }) => { viewStates.push(state) })
  await page.addInitScript(() => {
    const invoke = (window as unknown as { mcpFixtureInvoke: (method: string, input: unknown) => Promise<unknown> }).mcpFixtureInvoke
    const pending = new Map<string, (result: unknown) => void>()
    Object.defineProperty(window, 'mossApp', { value: {
      app: {
        getInfo: async () => ({ appearance: { themeMode: 'system', cssThemeId: 'default' } }),
        getInstallationState: async () => ({ installation: { enabled: true } }),
        getStatus: async () => ({ state: 'running' }),
      },
      host: {
        request: async (_protocol: string, method: string, input: unknown, options: { requestId: string }) => {
          if (method === 'capabilities.get') return { ok: true, result: { capabilities: [{ protocol: 'moss.mcp/v1', method: 'servers.list', available: true }] } }
          try {
            return await Promise.race([
              invoke(method, input).then(result => (result as { ok?: boolean }).ok === false ? result : { ok: true, result }),
              new Promise(resolve => { pending.set(options.requestId, resolve) }),
            ])
          } finally { pending.delete(options.requestId) }
        },
        cancel: async (requestId: string) => {
          pending.get(requestId)?.({ ok: false, error: { code: 'APP_ACTION_CANCELED', message: 'App request cancelled' } })
          await (window as any).mcpFixtureCancel()
        },
        onEvent: () => () => {}, unsubscribe: async () => ({}), subscribe: async () => ({ ok: true, result: {} }),
      },
      events: { on: () => () => {} },
      view: { setState: async (state: unknown) => (window as any).mcpFixtureViewState(state) },
    } })
  })
  return { releaseList, releaseInspection, calls, requests, viewStates, cancellations: () => cancellations, completedInspections: () => completedInspections, recoverInspection: () => { inspectError = undefined }, failNextList: () => { failList = true } }
}
