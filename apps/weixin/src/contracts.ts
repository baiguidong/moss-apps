export type ResponseMode = 'invoke' | 'stream'

export interface ChannelSettings {
  accountId: string
  baseUrl: string
  agentId: string | null
  responseMode: ResponseMode
  showThinking?: boolean
  showToolHints?: boolean
  allowedTools?: string[] | null
}

export interface ChannelStatus {
  configured: boolean
  connected: boolean
  progressUnavailable?: boolean
  error?: string
}

export type RegistrationStatus =
  | { status: 'running'; qr_url?: string; scanned?: boolean }
  | { status: 'finished'; accountId: string; token: string; baseUrl: string }
  | { status: 'failed'; reason: string }
  | { status: 'not_started' }
