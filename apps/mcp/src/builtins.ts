import type { Catalog, Input, Method, SaveInput } from './contracts'

export const PLAYWRIGHT_CDP = 'playwright-cdp'
export const PLAYWRIGHT_VERSION = '0.0.83'
export function isBundledConfig(config: { args?: string[] }) {
  return /(?:^|[/\\])playwright-cdp[/\\]cli\.cjs$/.test(config.args?.[0] || '')
}
export const BUILTIN_SERVERS: SaveInput[] = [{
  name: PLAYWRIGHT_CDP,
  enabled: true,
  config: {
    type: 'stdio',
    command: 'node',
    args: ['playwright-cdp/cli.cjs', '--cdp-endpoint', 'http://127.0.0.1:9222', '--output-dir', '~/.moss/artifacts/playwright'],
  },
}]

export function isBuiltin(name?: string) { return BUILTIN_SERVERS.some(server => server.name === name) }
export function withBuiltins(catalog: Catalog): Catalog {
  return { ...catalog, servers: catalog.servers.map(server => ({ ...server, builtin: isBuiltin(server.name), bundled: isBuiltin(server.name) && isBundledConfig(server.config) })) }
}
export function validateBuiltinAction(method: Method, input: Input) {
  if (method === 'servers.remove' && isBuiltin(input.name)) throw new Error('内置服务可停用，不能删除。')
  if (method === 'servers.save' && isBuiltin(input.previousName) && input.name !== input.previousName) throw new Error('内置服务的名称不能修改。')
}
