import type { McpConfig, McpCatalog, McpServer } from '@moss/app-sdk/mcp'
export type { McpConfig, McpServer }
export const METHODS = ['servers.list', 'servers.save', 'servers.inspect'] as const
export type Method = typeof METHODS[number]
export type Preparation = { state: 'configuring' | 'preparing' | 'connecting' | 'ready' | 'failed'; error?: string }
export type Catalog = McpCatalog & { preparation: Preparation }
export type SaveInput = { name: string; previousName?: string; enabled: boolean; config: McpConfig }
export type Input = Partial<SaveInput>
export type Result = { ok: true; data: Catalog } | { ok: false; error: { code?: string; message: string } }
export const timeout = () => 65_000
