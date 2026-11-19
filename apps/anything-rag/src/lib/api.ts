import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'

declare global { interface Window { mossApp?: AppUiApi } }
export const client = window.mossApp ? createAppClient(window.mossApp) : null
export type Space = { id: string; name: string; documentCount?: number; createdAt?: string; updatedAt?: string }
export type Document = { chunkId?: string; title?: string; source?: string; page?: number | null; id: string; spaceId: string; sourcePath: string; filename: string; mime: string; content?: string; checksum?: string; revision: number; pinned?: number; watched?: number; status?: string; error?: string | null; resourceId?: string; uri?: string; snippet?: string; score?: number; semanticScore?: number; lexicalScore?: number; chunks?: number; nextOffset?: number | null; totalLength?: number }
export type EngineStatus = { state: string; engine: { state: string; model: string; revision?: string; fallback: boolean; native?: boolean; bundled?: boolean; sourceUrl?: string; error: string | null; cacheDir?: string; dimension: number }; spaces: Space[]; documents: number; activeJob?: Job | null; lastJob?: Job | null; settings: Settings }
export type Job = { id: string; kind: string; status: string; total: number; completed: number; message: string; error?: string | null; createdAt: string; updatedAt: string }
export type Settings = { embeddingModel: string; topK: number; threshold: number; hybridAlpha: number; rerank: boolean; refusal: boolean }
export type SearchResult = { query: string; items: Document[]; accepted: boolean; refusal: string | null; diagnostics: Record<string, unknown> }
export async function request<T>(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!client) throw new Error('请在 Moss 中安装并打开此 App。')
  return client.actions.invoke(name, input, { signal, timeoutMs: name.startsWith('files.') || name === 'index.rebuild' ? 300000 : 60000 }) as Promise<T>
}
