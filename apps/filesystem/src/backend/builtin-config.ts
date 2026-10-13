import { fileURLToPath } from 'node:url'
import type { McpConfig } from '@moss/app-sdk/mcp'
import { validateSettings, type Settings } from '../contracts'
export const bundledEntry = fileURLToPath(new URL('../server/cli.mjs', import.meta.url))
export function serviceConfig(settings: Settings): McpConfig {
  return { type: 'stdio', command: process.execPath, args: [bundledEntry, JSON.stringify(settings)], disabledTools: settings.disabledTools }
}
export function settingsFromConfig(config: McpConfig): Settings {
  if (config.type !== 'stdio' || !config.args?.[1]) throw new Error('连接配置不完整，请重新保存设置。')
  return validateSettings({ ...JSON.parse(config.args[1]), disabledTools: config.disabledTools || [] })
}
