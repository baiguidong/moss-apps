import { fileURLToPath } from 'node:url'
import type { McpConfig } from '@moss/app-sdk/mcp'
export const bundledEntry = fileURLToPath(new URL('../sequential-server/cli.mjs', import.meta.url))
export function thinkingConfig(): McpConfig {
  return { type: 'stdio', command: process.execPath, args: [bundledEntry] }
}
