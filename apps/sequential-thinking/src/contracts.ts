import type { McpCatalog } from '@moss/app-sdk/mcp'
export const THINKING = 'sequential-thinking'
export const METHODS = ['servers.list', 'servers.inspect'] as const
export type Method = typeof METHODS[number]
export type Preparation = { state: 'configuring' | 'connecting' | 'ready' | 'failed'; error?: string }
export type Catalog = McpCatalog & { preparation: Preparation }
export type Result = { ok: true; data: Catalog } | { ok: false; error: { code?: string; message: string } }
