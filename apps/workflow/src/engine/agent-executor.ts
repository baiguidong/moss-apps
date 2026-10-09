import type { WorkflowAgentOptions } from './types.js'

export type WorkflowAgentRunParams = {
  prompt: string
  opts?: WorkflowAgentOptions
  runId: string
  contextKey: string
  idempotencyKey: string
  workflow?: unknown
  abortController: AbortController
  conversation?: { agentId: string; messages: unknown[] }
  resumeAgentId?: string
  onAgentId: (id: string) => void
  onProgress: (progress: { tokens: number; toolCalls: number; lastToolName?: string }) => void
}
export type WorkflowAgentRunResult = {
  agentId: string
  value: unknown
  tokens: number
  toolCalls: number
  conversationMessages?: unknown[]
}
export async function runWorkflowAgent(_params: WorkflowAgentRunParams): Promise<WorkflowAgentRunResult> {
  throw new Error('Agent executor is not connected to Moss')
}
export function createWorkflowAgentController(parent?: AbortSignal) {
  const controller = new AbortController()
  const cancel = () => controller.abort(parent?.reason)
  if (parent?.aborted) cancel()
  else parent?.addEventListener('abort', cancel, { once: true })
  controller.signal.addEventListener('abort', () => parent?.removeEventListener('abort', cancel), { once: true })
  return controller
}
