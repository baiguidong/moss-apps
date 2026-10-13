import type { McpCatalog, McpServer } from '@moss/app-sdk/mcp'
export type { McpServer }
export const SERVICE = 'filesystem'
export const SERVICE_VERSION = '2026.8.31'
export const TITLE = '文件系统'
export const METHODS = ['servers.list', 'servers.save', 'servers.inspect'] as const
export type Method = typeof METHODS[number]
export type Preparation = { state: 'waiting' | 'configuring' | 'connecting' | 'ready' | 'failed'; error?: string }
export type Settings = { directories: string[]; disabledTools: string[];  }
export type SaveInput = Settings
export type Input = Partial<Settings>
export const DEFAULT_SETTINGS: Settings = { directories: [], disabledTools: [],  }
export type Catalog = McpCatalog & { preparation: Preparation; settings: Settings }
export type Result = { ok: true; data: Catalog } | { ok: false; error: { code?: string; message: string } }
export const timeout = () => 65_000
export function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设置格式不正确。')
  const value = raw as Settings
  const keys = ['directories', 'disabledTools']
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('设置包含不支持的字段。')
  const validateList = (list: unknown, max: number, length: number, label: string): string[] => {
    if (!Array.isArray(list) || list.length > max || list.some(item => typeof item !== 'string' || !item.trim() || item.length > length || /[\x00\r\n]/.test(item))) throw new Error(`请填写有效的${label}，每行一项。`)
    return [...new Set(list.map(item => item.trim()))]
  }

  return { directories: validateList(value.directories, 32, 4096, '目录路径'), disabledTools: validateList(value.disabledTools, 200, 128, '工具名称'),  }
}
