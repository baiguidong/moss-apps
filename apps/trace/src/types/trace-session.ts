export type MessageUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  toolUseResult?: unknown
  timestamp: string
  model?: string
  usage?: MessageUsage
  /**
   * Identity of the API response this `usage` belongs to, when it has one. One assistant reply
   * is persisted as several lines that each repeat the whole `usage` object, so anything that
   * totals usage must count each key once. Absent means the line carries no id — count it.
   */
  usageKey?: string
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}
