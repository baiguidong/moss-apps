export type Transport = 'stdio' | 'http' | 'sse'
export type McpConfig = {
  type: Transport; command?: string; args?: string[]; env?: Record<string, string>;
  url?: string; headers?: Record<string, string>; disabledTools?: string[];
  oauth?: { clientId?: string; redirectUri?: string; [key: string]: unknown };
}
export type Tool = { name: string; description: string; disabled: boolean }
export type ConnectionCheck = { state: 'connected' | 'needs-auth' | 'authorized' | 'unchecked' | 'failed'; tools: Tool[]; checkedAt: number; durationMs?: number; truncated?: boolean; error?: string; serverInfo?: { name: string; version: string } }
export type McpServer = { name: string; enabled: boolean; config: McpConfig; updatedAt: number; builtin?: boolean; bundled?: boolean; credentialsMissing?: boolean; check?: ConnectionCheck | null }
export type Catalog = { servers: McpServer[]; setupError?: string; resetSessionCount?: number; skippedBusySessionCount?: number }
export type SaveInput = { name: string; previousName?: string; enabled: boolean; config: McpConfig }
export const METHODS = ['servers.list', 'servers.save', 'servers.remove', 'servers.set-enabled', 'servers.inspect', 'auth.start', 'auth.clear'] as const
export type Method = typeof METHODS[number]
export type Input = { name?: string; previousName?: string; enabled?: boolean; config?: McpConfig }
export type Result = { ok: true; data: Catalog } | { ok: false; error: { code?: string; message: string } }
export const timeout = (method: Method) => method === 'auth.start' ? 300_000 : 65_000

export function endpoint(config: McpConfig): string {
  if (config.type === 'stdio') return config.command || '本地进程'
  try { const url = new URL(config.url || ''); return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}` }
  catch { return '远程服务' }
}
export function status(server: McpServer): { label: string; tone: string } {
  if (!server.enabled) return { label: '已停用', tone: 'muted' }
  if (server.credentialsMissing) return { label: '待补充凭据', tone: 'warning' }
  if (server.check?.state === 'failed') return { label: '连接失败', tone: 'error' }
  if (server.check?.state === 'connected') return { label: '检查通过', tone: 'success' }
  if (server.check?.state === 'needs-auth') return { label: '需要授权', tone: 'warning' }
  if (server.check?.state === 'authorized') return { label: '已授权', tone: 'success' }
  return { label: '未检查', tone: 'muted' }
}
