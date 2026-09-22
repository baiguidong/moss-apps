export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export type FeishuConfig = {
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
}

export type AdapterConfig = {
  feishu: FeishuConfig
}

export type AppBackendConfigurationContext = {
  config?: Record<string, unknown>
  secrets?: Record<string, unknown>
  dataDir?: string
  target?: { type?: string; id?: string }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : []
}

function pairedUsers(value: unknown): PairedUser[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const candidate = entry as Record<string, unknown>
    const userId = typeof candidate.userId === 'number'
      ? candidate.userId
      : String(candidate.userId || '').trim()
    if (userId === '') return []
    return [{
      userId,
      displayName: String(candidate.displayName || 'Feishu User').trim() || 'Feishu User',
      pairedAt: Number(candidate.pairedAt) || 0,
    }]
  })
}

export function loadConfigFromAppContext(context: AppBackendConfigurationContext): AdapterConfig {
  const appConfig = context.config && typeof context.config === 'object' ? context.config : {}
  const secrets = context.secrets && typeof context.secrets === 'object' ? context.secrets : {}
  return {
    feishu: {
      appId: String(appConfig.appId || '').trim(),
      appSecret: String(secrets.appSecret || ''),
      encryptKey: String(secrets.encryptKey || ''),
      verificationToken: String(secrets.verificationToken || ''),
      allowedUsers: stringList(appConfig.allowedUsers),
      pairedUsers: pairedUsers(appConfig.pairedUsers),
    },
  }
}
