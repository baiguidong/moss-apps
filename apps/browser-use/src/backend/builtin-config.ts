import { fileURLToPath } from 'node:url'
import { browserArgs } from '../browser-config'
import type { McpConfig } from '../contracts'

export const bundledEntry = fileURLToPath(new URL('../playwright-cdp/cli.cjs', import.meta.url))
export function useBundledPlaywright(config: McpConfig): McpConfig {
  if (config.type !== 'stdio') throw new Error('网页操控使用随应用提供的 Playwright MCP。')
  return { ...config, command: process.execPath, args: [bundledEntry, ...browserArgs(config)] }
}
