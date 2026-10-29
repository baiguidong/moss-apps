import type { McpConfig } from './contracts'

export const PLAYWRIGHT_CDP = 'playwright-cdp'
export const PLAYWRIGHT_VERSION = '0.0.83'
export const EXTENSION_URL = 'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm'
export const DEFAULT_CONFIG: McpConfig = {
  type: 'stdio', command: 'node',
  args: ['playwright-cdp/cli.cjs', '--moss-managed-browser', '--output-dir', '~/.moss/artifacts/playwright'],
}
export const optionNames = ['--cdp-endpoint', '--executable-path', '--user-data-dir', '--profile-dir-name', '--output-dir'] as const
export type BrowserFields = Record<typeof optionNames[number], string> & { mode: 'managed' | 'extension' | 'cdp'; extensionToken: string; extra: string }

export function browserArgs(config: McpConfig): string[] {
  const args = config.args || []
  return /(?:^|[/\\])playwright-cdp[/\\]cli\.cjs$/.test(args[0] || '') ? args.slice(1) : args
}

export function browserFields(config: McpConfig): BrowserFields {
  const fields: BrowserFields = { mode: 'extension', extensionToken: '', '--cdp-endpoint': '', '--executable-path': '', '--user-data-dir': '', '--profile-dir-name': '', '--output-dir': '', extra: '' }
  const extra: string[] = [], args = browserArgs(config)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--extension' || args[i] === '--moss-managed-browser') continue
    const name = optionNames.find(name => args[i] === name || args[i].startsWith(`${name}=`))
    if (!name) { extra.push(args[i]); continue }
    fields[name] = args[i] === name ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '') : args[i].slice(name.length + 1)
  }
  if (!fields['--cdp-endpoint']) fields['--cdp-endpoint'] = config.env?.PLAYWRIGHT_MCP_CDP_ENDPOINT || ''
  if (fields['--cdp-endpoint'] || Object.hasOwn(config.env || {}, 'PLAYWRIGHT_MCP_CDP_ENDPOINT')) fields.mode = 'cdp'
  if (args.includes('--moss-managed-browser')) fields.mode = 'managed'
  fields.extra = extra.join('\n')
  return fields
}

export function configFromFields(config: McpConfig, fields: BrowserFields, excluded: string): McpConfig {
  const keepEndpoint = fields.mode === 'cdp' && !fields['--cdp-endpoint'].trim() && browserFields(config).mode === 'cdp' && Object.hasOwn(config.env || {}, 'PLAYWRIGHT_MCP_CDP_ENDPOINT')
  if (fields.mode === 'extension' && fields['--executable-path'].trim() && !fields['--user-data-dir'].trim()) {
    throw new Error('自定义 Chrome 路径时，请同时填写已安装扩展的现有 Chrome 用户目录。')
  }
  if (fields.mode === 'cdp' && !keepEndpoint) {
    let endpoint: URL
    try { endpoint = new URL(fields['--cdp-endpoint'].trim()) } catch { throw new Error('请填写有效的 CDP 地址。') }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('CDP 地址需要使用 http、https、ws 或 wss。')
  }
  const extra = fields.extra.split('\n').map(value => value.trim()).filter(Boolean)
  if (extra.some(value => [...optionNames, '--extension', '--moss-managed-browser', '--isolated', '--config'].some(name => value === name || value.startsWith(`${name}=`)))) throw new Error('请在上方对应字段中选择连接方式、浏览器路径和地址。')
  const env: Record<string, string> = { ...config.env, MOSS_BROWSER_CONNECTION_MODE: fields.mode }
  if (fields.extensionToken.trim()) env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = fields.extensionToken.trim()
  // Switching modes must also clear an old environment-based connection override.
  if (!keepEndpoint) delete env.PLAYWRIGHT_MCP_CDP_ENDPOINT
  delete env.PLAYWRIGHT_MCP_EXTENSION
  delete env.PLAYWRIGHT_MCP_ISOLATED
  delete env.PLAYWRIGHT_MCP_ENDPOINT
  return { ...config, type: 'stdio', env, args: ['playwright-cdp/cli.cjs',
    ...(fields.mode === 'extension' ? ['--extension'] : fields.mode === 'managed' ? ['--moss-managed-browser'] : []),
    ...optionNames.flatMap(name => name === '--cdp-endpoint' && fields.mode === 'extension' ? []
      : fields.mode === 'managed' && !['--cdp-endpoint', '--output-dir'].includes(name) ? []
      : fields[name].trim() ? [name, fields[name].trim()] : []), ...extra],
    disabledTools: excluded.split('\n').map(value => value.trim()).filter(Boolean) }
}

export function connectionTarget(config: McpConfig) {
  const fields = browserFields(config)
  if (fields.mode === 'managed') return 'Moss 专用 · 保留登录状态'
  if (fields.mode === 'extension') return '系统 Chrome · 已有用户配置'
  const raw = fields['--cdp-endpoint'] || config.env?.PLAYWRIGHT_MCP_CDP_ENDPOINT || ''
  try {
    const url = new URL(raw)
    // Connection details may include credentials; the summary displays only the origin.
    return `${url.protocol}//${url.host}`
  } catch { return '未配置 CDP 地址' }
}

// Upgrade only our former default. Explicitly saved CDP connections and remote
// configurations keep their addresses, credentials, and other options.
export function migrateLegacyBrowserConfig(config: McpConfig): McpConfig {
  // Repair settings already migrated by 0.1.3 with obsolete launch overrides.
  // Managed mode always owns its executable and profile, even after an explicit save.
  const currentArgs = browserArgs(config)
  if (currentArgs.includes('--moss-managed-browser')) {
    const kept: string[] = []
    const removed = ['--executable-path', '--user-data-dir', '--profile-dir-name']
    for (let i = 0; i < currentArgs.length; i++) {
      if (removed.includes(currentArgs[i])) { i++; continue }
      if (!removed.some(name => currentArgs[i].startsWith(name + '='))) kept.push(currentArgs[i])
    }
    return kept.length === currentArgs.length ? config : { ...config, args: ['playwright-cdp/cli.cjs', ...kept] }
  }
  // The Host redacts env values in servers.list. Presence, rather than truthiness,
  // is what preserves an explicit choice across App/Host restarts.
  if (['MOSS_BROWSER_CONNECTION_MODE', 'PLAYWRIGHT_MCP_CDP_ENDPOINT', 'PLAYWRIGHT_MCP_ENDPOINT', 'PLAYWRIGHT_MCP_CDP_HEADERS', 'PLAYWRIGHT_MCP_USER_DATA_DIR']
    .some(name => Object.hasOwn(config.env || {}, name))) return config
  const fields = browserFields(config)
  let endpoint: URL
  try { endpoint = new URL(fields['--cdp-endpoint']) } catch { return config }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== '9222'
    || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) return config
  const profile = fields['--user-data-dir'].replaceAll('\\', '/')
  if (profile && !profile.endsWith('/.moss/browser-profiles/playwright-cdp-9222')) return config
  if (/(?:^|\n)--(?:config|cdp-header|endpoint)(?:=|\n)/.test(fields.extra)) return config
  const args = browserArgs(config), kept: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (['--cdp-endpoint', '--user-data-dir', '--executable-path', '--profile-dir-name'].includes(args[i])) { i++; continue }
    if (['--cdp-endpoint=', '--user-data-dir=', '--executable-path=', '--profile-dir-name='].some(prefix => args[i].startsWith(prefix))) continue
    if (['--extension', '--headless', '--isolated'].includes(args[i])) continue
    kept.push(args[i])
  }
  return { ...config, args: ['playwright-cdp/cli.cjs', '--moss-managed-browser', ...kept] }
}
