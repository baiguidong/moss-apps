export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type Method = typeof METHODS[number]
export type Pair = { name: string; value: string; enabled: boolean }
export type Auth = { type: 'none' | 'basic' | 'bearer'; username: string; password: string; token: string }
export type RequestInput = {
  method: Method; url: string; query: Pair[]; headers: Pair[]
  bodyMode: 'none' | 'json' | 'text' | 'form'; body: string; form: Pair[]; auth: Auth
  timeoutMs: number; followRedirects: boolean
}
export type RequestResult = {
  url: string; method: string; status: number; statusText: string
  headers: { name: string; value: string }[]; body: string; bodyEncoding: 'text' | 'base64'
  bytes: number; truncated: boolean; durationMs: number; contentType: string
  redirects: { status: number; url: string }[]; notice: string
}
export type Template = { id: string; name: string; request: RequestInput }
export const emptyPair = (): Pair => ({ name: '', value: '', enabled: true })
export const emptyRequest = (): RequestInput => ({
  method: 'GET', url: '', query: [emptyPair()], headers: [emptyPair()],
  bodyMode: 'none', body: '', form: [emptyPair()],
  auth: { type: 'none', username: '', password: '', token: '' }, timeoutMs: 30000, followRedirects: true,
})
export const RESPONSE_LIMIT = 1024 * 1024
