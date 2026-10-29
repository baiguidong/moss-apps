import type { McpCatalog, McpServer } from '@moss/app-sdk/mcp'
export type { McpServer }
export const MEMORY = 'memory'
export const MEMORY_VERSION = '2026.8.31'
export const METHODS = ['servers.list', 'servers.save', 'servers.inspect'] as const
export type Method = typeof METHODS[number]
export type Preparation = { state: 'idle' | 'configuring' | 'connecting' | 'ready' | 'failed'; error?: string }
export type Catalog = McpCatalog & { preparation: Preparation; memoryFile: string }
export type SaveInput = { disabledTools: string[] }
export type Input = Partial<SaveInput>
export type Result = { ok: true; data: Catalog } | { ok: false; error: { code?: string; message: string } }
export type MemoryEntity = { name: string; entityType: string; observations: string[] }
export type MemoryRelation = { from: string; to: string; relationType: string }
export type GraphInput = { query?: string; entityType?: string; offset?: number }
export type MemoryGraph = {
  entities: MemoryEntity[]; relations: MemoryRelation[]
  totalEntities: number; totalRelations: number; totalMatches: number
  types: { name: string; count: number }[]
  offset: number; nextOffset: number | null; updatedAt: number | null; unresolvedRelations: number
}
export type GraphResult = { ok: true; data: MemoryGraph } | { ok: false; error: { message: string } }
export const timeout = () => 65_000

export function validateSettings(raw: unknown): SaveInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设置格式不正确。')
  const value = raw as SaveInput
  if (Object.keys(value).some(key => key !== 'disabledTools') || !Array.isArray(value.disabledTools)
    || value.disabledTools.length > 200 || value.disabledTools.some(name => typeof name !== 'string' || !name.trim() || name.length > 128)) {
    throw new Error('请填写有效的工具名称，每行一项。')
  }
  return { disabledTools: [...new Set(value.disabledTools.map(name => name.trim()))] }
}
