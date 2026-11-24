export type FeishuDomain = 'feishu' | 'lark'
export type ResponseMode = 'invoke' | 'stream'

export interface ChannelSettings {
  appId: string
  domain: FeishuDomain
  agentId: string | null
  responseMode: ResponseMode
  showThinking?: boolean
  showToolHints?: boolean
  allowedTools?: string[] | null
  allowedUsers?: string[]
}

export interface Credentials {
  appSecret?: string
  encryptKey?: string
  verificationToken?: string
}

export interface ChannelStatus {
  configured: boolean
  connected: boolean
  error?: string
  hasEncryptKey: boolean
  hasVerificationToken: boolean
  allowedTools?: string[] | null
}

export type RegistrationStatus =
  | { status: 'running'; qr_url?: string }
  | { status: 'finished'; app_id: string; app_secret: string; domain: FeishuDomain }
  | { status: 'failed'; reason: string }
  | { status: 'not_started' }
