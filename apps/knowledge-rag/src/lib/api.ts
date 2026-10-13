import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
declare global { interface Window { mossApp?: AppUiApi } }
export type Preparation = {
  steps: { id: string; label: string; state: 'pending' | 'active' | 'done' | 'cached' | 'failed' | 'cancelled' }[]
  stage: string | null; detail: string; observedAt: number; startedAt: number; elapsedMs: number; stageElapsedMs: number; idleMs: number
  download: { completed: number; total: number; file: string } | null; logs: string[]
}
export type EngineStatus = { state: string; installed: boolean; message: string; error: string | null; version: string; model: string; url?: string; preparation?: Preparation | null; reindex?: { active: boolean; percent?: number; progress?: string; last_error?: string; last_result?: { errors?: number } } }
export type Document = { filepath: string; filename: string; content?: string; score?: number; category?: string; nextOffset?: number | null; totalLength?: number }
export const client = window.mossApp ? createAppClient(window.mossApp) : null
export async function request<T>(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!client) throw new Error('请在 Moss 中安装并打开此 App。')
  return client.actions.invoke(name, input, { signal, timeoutMs: name === 'engine.status' ? 15000 : 300000 }) as Promise<T>
}
