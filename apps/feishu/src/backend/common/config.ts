export type FeishuConfig = {
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  allowedUsers: string[]
}

export type AdapterConfig = {
  feishu: FeishuConfig
}

export type AppBackendConfigurationContext = {
  config?: Record<string, unknown>
  secrets?: Record<string, unknown>
  dataDir?: string
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : []
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
    },
  }
}
