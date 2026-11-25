export const channels = {
  qq: { url: 'https://q.qq.com/qqbot/openclaw/', name: 'QQ', id: 'App ID', secret: 'App Secret', guide: '填写 QQ 开放平台的机器人凭据。' },
  wecom: { url: 'https://work.weixin.qq.com/wework_admin/frame#/aiHelper/create', name: '企业微信', id: 'Bot ID', secret: 'Secret', guide: '填写企业微信智能机器人的长连接凭据。' },
  dingtalk: { url: 'https://open-dev.dingtalk.com/', name: '钉钉', id: 'Client ID', secret: 'Client Secret', guide: '填写已启用 Stream 模式的钉钉机器人的应用凭据。' },
  telegram: { url: 'https://t.me/BotFather', name: 'Telegram', id: '', secret: 'Bot Token', guide: '在 Telegram 中打开 @BotFather，使用 /newbot 创建机器人并复制 Bot Token。' },
  discord: { url: 'https://discord.com/developers/applications', name: 'Discord', id: '', secret: 'Bot Token', guide: '从 Discord Developer Portal 的 Bot 页面复制 Token，启用 Message Content Intent 并邀请机器人加入服务器。' },
} as const
export type Kind = keyof typeof channels
export type RegistrationStatus =
  | { status: 'running'; qr_url?: string; code?: string }
  | { status: 'finished'; accountId: string; token: string }
  | { status: 'failed'; reason: string }
  | { status: 'not_started' }
export interface ChannelStatus {
  configured: boolean
  connected: boolean
  progressUnavailable?: boolean
  error?: string
}
export interface ChannelSettings {
  accountId?: string
  agentId?: string | null
  responseMode?: 'stream' | 'invoke'
  showThinking?: boolean
  showToolHints?: boolean
  allowedTools?: string[] | null
  allowedUserIds?: string[]
  allowedChannelIds?: string[]
  allowAllChannels?: boolean
  httpProxy?: string
  websocketUrl?: string
  groupContext?: { visibility: string; activation: string; history_limit: number; clear_after_reply: boolean }
}
