import { fileURLToPath } from 'node:url'
import { BUILTIN_SERVERS, isBundledConfig, PLAYWRIGHT_VERSION } from '../builtins'
import type { McpConfig } from '../contracts'

export const bundledEntry = fileURLToPath(new URL('../playwright-cdp/cli.cjs', import.meta.url))
export function useBundledPlaywright(config: McpConfig): McpConfig {
  if (config.type !== 'stdio') return config
  let args = config.args || []
  if (isBundledConfig(config)) args = args.slice(1)
  else {
    // Upgrade the previously offered npx preset, preserving CDP/output/tool options.
    // Unrelated custom launchers or explicitly chosen package versions remain user-managed.
    if (!/(?:^|[/\\])npx(?:\.cmd|\.exe)?$/i.test(config.command || '')) return config
    const index = args.indexOf(`@playwright/mcp@${PLAYWRIGHT_VERSION}`)
    if (index < 0 || args.slice(0, index).some(arg => !['-y', '--yes'].includes(arg))) return config
    args = args.slice(index + 1)
  }
  return { ...config, command: process.execPath, args: [bundledEntry, ...args] }
}
export const builtinServers = BUILTIN_SERVERS.map(server => ({ ...server, config: useBundledPlaywright(server.config) }))
