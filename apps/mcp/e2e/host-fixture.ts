import type { Page } from '@playwright/test'
import type { Input, McpServer, Method, Tool } from '../src/contracts'
import { withBuiltins } from '../src/builtins'

/** Controlled Host responses for UI states; never installed in the App bundle. */
export async function installHostFixture(page: Page, options: { holdInitialList?: boolean; failInitialList?: boolean; servers?: McpServer[]; inspectError?: string; holdInspection?: boolean; tools?: Tool[]; staleInspection?: boolean } = {}) {
  let servers: McpServer[] = structuredClone(options.servers || [])
  let inspectError = options.inspectError
  let failList = Boolean(options.failInitialList)
  let releaseList = () => {}
  let releaseInspection = () => {}
  const calls: Method[] = []
  let cancellations = 0
  const inspection = options.holdInspection ? new Promise<void>(resolve => { releaseInspection = resolve }) : Promise.resolve()
  const initialList = options.holdInitialList ? new Promise<void>(resolve => { releaseList = resolve }) : Promise.resolve()
  await page.exposeFunction('mcpFixtureInvoke', async (method: Method, input: Input = {}) => {
    calls.push(method)
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
      if (server) {
        server.check = inspectError ? { state: 'failed', error: inspectError, tools: [], checkedAt: Date.now() } : { state: 'connected', tools: (options.tools || []).map(tool => ({ ...tool, disabled: server.config.disabledTools?.includes(tool.name) || tool.disabled })), checkedAt: Date.now() }
        const current = servers.find(item => item.name === server.name)
        if (current?.updatedAt === server.updatedAt && current?.enabled === server.enabled) current.check = server.check
        if (options.staleInspection) server.updatedAt++
      }
      return { ok: true, data: withBuiltins({ servers: snapshot }) }
    } else if (method === 'servers.set-enabled') {
      servers = servers.map(server => server.name === input.name ? { ...server, enabled: input.enabled!, updatedAt: Date.now(), check: null } : server)
    } else if (method === 'servers.remove') {
      servers = servers.filter(server => server.name !== input.name)
    }
    return { ok: true, data: withBuiltins({ servers }) }
  })
  await page.exposeFunction('mcpFixtureCancel', () => { cancellations++ })
  await page.addInitScript(() => {
    const invoke = (window as unknown as { mcpFixtureInvoke: (method: string, input: unknown) => Promise<unknown> }).mcpFixtureInvoke
    Object.defineProperty(window, 'mossApp', { value: {
      app: {
        getInfo: async () => ({ appearance: { themeMode: 'system', cssThemeId: 'default' } }),
        getInstallationState: async () => ({ installation: { enabled: true } }),
        getStatus: async () => ({ state: 'running' }),
      },
      actions: { invoke: async (method: string, input: unknown) => ({ ok: true, result: await invoke(method, input) }), cancel: () => (window as any).mcpFixtureCancel() },
      events: { on: () => () => {} },
    } })
  })
  return { releaseList, releaseInspection, calls, cancellations: () => cancellations, recoverInspection: () => { inspectError = undefined }, failNextList: () => { failList = true } }
}
