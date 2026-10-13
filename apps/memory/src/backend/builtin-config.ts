import { fileURLToPath } from 'node:url'
import type { McpConfig } from '@moss/app-sdk/mcp'

export const bundledEntry = fileURLToPath(new URL('../memory-server/cli.mjs', import.meta.url))
export function memoryConfig(memoryFile: string, disabledTools: string[] = []): McpConfig {
  return { type: 'stdio', command: process.execPath, args: [bundledEntry, memoryFile], disabledTools }
}
