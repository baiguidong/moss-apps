import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
declare global { interface Window { mossApp?: AppUiApi } }
export type Preparation = {
  steps: { id: string; label: string; state: 'pending' | 'active' | 'done' | 'cached' | 'failed' | 'cancelled' }[]
  stage: string | null; detail: string; observedAt: number; startedAt: number; elapsedMs: number; stageElapsedMs: number; idleMs: number
  download: { completed: number; total: number; file: string } | null; logs: string[]
}
export type EngineStatus = {
  state: string; installed: boolean; message: string; error: string | null; version: string; model: string; url?: string
  runtime?: { python?: { available: boolean | null; path: string | null; version: string | null; source: string; error: string | null } }
  preparation?: Preparation | null
  reindex?: {
    active: boolean; operation?: string; percent?: number; progress?: string; indexed?: number; skipped?: number
    errors?: number; chunks_processed?: number; chunks_total?: number; started_at?: string; last_error?: string
    throughput_cps?: number; eta_seconds?: number; checkpoint_saved_at?: string; resumed?: boolean
    last_result?: { updated?: number; deleted?: number; indexed?: number; skipped?: number; errors?: number }
  }
}
export type Document = { filepath: string; filename: string; content?: string; score?: number; category?: string; chunks?: number; chunk_count?: number; chunk_index?: number; search_method?: string; keywords?: string[]; nextOffset?: number | null; totalLength?: number }
export const client = window.mossApp ? createAppClient(window.mossApp) : null
export async function request<T>(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!client) throw new Error('请在 Moss 中安装并打开此 App。')
  return client.actions.invoke(name, input, { signal, timeoutMs: name === 'engine.status' ? 15000 : 300000 }) as Promise<T>
}

export type Catalog = { counts: Record<string, number>; supported: string[] }
export type IndexStats = {
  total_documents: number; total_chunks: number; embedding_model: string; embedding_dim: number
  chunk_size: number; chunk_overlap: number; reranker_model: string
  supported_formats: string[]
  query_cache: { size: number; max_size: number; hit_rate: string; hits: number; misses: number; ttl_seconds: number }
}
export type Evaluation = {
  total_queries: number; mrr_at_5: number; recall_at_5: number
  per_query: { query: string; expected: string; found_at_rank: number | null; top_result: string }[]
}
