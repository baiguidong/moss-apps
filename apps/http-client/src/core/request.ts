import { Buffer } from 'node:buffer'
import { METHODS, RESPONSE_LIMIT, emptyRequest, type Pair, type RequestInput, type RequestResult } from '../contracts'
import { formatJson } from './json'

export class RequestError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELED' | 'BUSY', message: string) { super(message) }
}
const invalid = (message: string): never => { throw new RequestError('INVALID_INPUT', message) }
function text(value: unknown, label: string, limit: number) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > limit) invalid(`${label}必须是文本，且不超过 ${limit.toLocaleString()} 字节。`)
  return value as string
}
function pairs(value: unknown, label: string): Pair[] {
  if (!Array.isArray(value) || value.length > 100) invalid(`${label}最多 100 项。`)
  return (value as unknown[]).map(item => {
    if (!item || typeof item !== 'object') invalid(`${label}格式不正确。`)
    const row = item as Record<string, unknown>
    if (typeof row.enabled !== 'boolean') invalid(`${label}启用状态不正确。`)
    return { name: text(row.name, `${label}名称`, 256), value: text(row.value, `${label}值`, 16384), enabled: row.enabled as boolean }
  })
}
function httpUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { return invalid('请输入完整地址，例如 https://api.example.com/users 或 http://localhost:3000。') }
  if (!['http:', 'https:'].includes(url.protocol)) invalid('只支持 http:// 和 https:// 地址。')
  if (url.username || url.password) invalid('请将地址中的用户名和密码移到“鉴权”中。')
  url.hash = ''
  return url
}
export function prepareRequest(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('请求格式不正确。')
  const input = { ...emptyRequest(), ...raw as Partial<RequestInput> }
  if (!METHODS.includes(input.method)) invalid('请选择有效的请求方法。')
  const url = httpUrl(text(input.url, 'URL', 16384).trim())
  const query = pairs(input.query, '查询参数'), rows = pairs(input.headers, '请求头'), form = pairs(input.form, '表单')
  for (const row of query) if (row.enabled && row.name) url.searchParams.append(row.name, row.value)
  if (url.href.length > 32768) invalid('请求地址与参数过长。')
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 120000) invalid('超时应为 1–120 秒。')
  if (typeof input.followRedirects !== 'boolean') invalid('重定向设置不正确。')
  if (!['none', 'json', 'text', 'form'].includes(input.bodyMode)) invalid('请选择有效的正文类型。')
  text(input.body, '请求正文', RESPONSE_LIMIT)
  const headers = new Headers()
  for (const row of rows) {
    if (!row.enabled || !row.name) continue
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(row.name) || /[\r\n\x00]/.test(row.value)) invalid('请求头名称或值无效，请移除换行和控制字符。')
    if (['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'proxy-authorization', 'proxy-connection', 'trailer', 'te', 'expect'].includes(row.name.toLowerCase())) invalid('Host、长度、连接及代理请求头由本地服务管理，请移除后重试。')
    try { headers.append(row.name, row.value) } catch { invalid('请求头值无效；非 ASCII 内容请先按目标接口要求编码。') }
  }
  const auth = input.auth
  if (!auth || typeof auth !== 'object' || !['none', 'basic', 'bearer'].includes(auth.type)) invalid('请选择有效的鉴权类型。')
  for (const key of ['username', 'password', 'token'] as const) text(auth[key], '鉴权内容', 16384)
  if (auth.type !== 'none' && headers.has('authorization')) invalid('鉴权与 Authorization 请求头只能填写一处。')
  if (auth.type === 'basic') {
    if (auth.username.includes(':')) invalid('Basic 用户名不能包含冒号。')
    headers.set('authorization', `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`)
  }
  if (auth.type === 'bearer') {
    if (!auth.token.trim() || /[^\x21-\x7e]/.test(auth.token)) invalid('Bearer Token 不能为空，也不能包含空格或换行。')
    headers.set('authorization', `Bearer ${auth.token}`)
  }
  let body: string | undefined
  if (input.bodyMode !== 'none') {
    if (['GET', 'HEAD'].includes(input.method)) invalid('GET 和 HEAD 不发送正文，请切换请求方法或将正文设为“无”。')
    body = input.bodyMode === 'form' ? new URLSearchParams(form.filter(row => row.enabled && row.name).map(row => [row.name, row.value])).toString() : input.body
    if (Buffer.byteLength(body) > RESPONSE_LIMIT) invalid('请求正文不能超过 1 MiB。')
    if (input.bodyMode === 'json') { try { formatJson(body) } catch (error) { invalid((error as Error).message) } }
    if (!headers.has('content-type')) headers.set('content-type', ({ json: 'application/json', text: 'text/plain; charset=utf-8', form: 'application/x-www-form-urlencoded' } as const)[input.bodyMode])
  }
  if (Buffer.byteLength(JSON.stringify([...headers])) > 65536) invalid('请求头总大小不能超过 64 KiB。')
  return { input, url, headers, body }
}

export async function sendRequest(raw: unknown, signal?: AbortSignal): Promise<RequestResult> {
  const prepared = prepareRequest(raw)
  let { url, headers, body } = prepared
  const { input } = prepared
  let method: string = input.method, timedOut = false, notice = ''
  const controller = new AbortController(), started = performance.now()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, input.timeoutMs)
  const redirects: RequestResult['redirects'] = []
  try {
    while (true) {
      const response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: 'manual' })
      const location = response.headers.get('location')
      if (input.followRedirects && location && [301, 302, 303, 307, 308].includes(response.status)) {
        let next: URL
        try { next = httpUrl(new URL(location, url).href) } catch { await response.body?.cancel(); throw new RequestError('INVALID_INPUT', '重定向地址无效或不是 HTTP(S) 地址。') }
        let nextMethod = method, nextBody = body
        if ((response.status === 303 && method !== 'HEAD') || ([301, 302].includes(response.status) && method === 'POST')) { nextMethod = 'GET'; nextBody = undefined }
        if (url.protocol === 'https:' && next.protocol === 'http:') notice = '已停止从 HTTPS 到 HTTP 的重定向，请确认 Location 后手动请求。'
        else if (url.origin !== next.origin && nextBody !== undefined) notice = '已停止携带正文的跨站重定向，请确认 Location 后手动请求。'
        else {
          await response.body?.cancel()
          if (redirects.length >= 10) throw new RequestError('NETWORK_ERROR', '重定向超过 10 次，请检查地址是否循环跳转。')
          redirects.push({ status: response.status, url: url.href })
          if (url.origin !== next.origin) headers = new Headers([...headers].filter(([name]) => ['accept', 'accept-language'].includes(name)))
          if (body !== undefined && nextBody === undefined) { headers.delete('content-type'); headers.delete('content-encoding') }
          url = next; method = nextMethod; body = nextBody
          continue
        }
      }
      const chunks: Uint8Array[] = []
      let bytes = 0, truncated = false
      if (response.body) {
        const reader = response.body.getReader()
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            const remaining = RESPONSE_LIMIT - bytes
            if (chunk.value.length > remaining) {
              chunks.push(chunk.value.subarray(0, remaining)); bytes = RESPONSE_LIMIT; truncated = true
              await reader.cancel(); break
            }
            chunks.push(chunk.value); bytes += chunk.value.length
          }
        } finally { reader.releaseLock() }
      }
      const buffer = Buffer.concat(chunks, bytes), contentType = response.headers.get('content-type') || ''
      let bodyEncoding: 'text' | 'base64' = 'text', output = ''
      const textual = /^(text\/|application\/(?:[\w.+-]*json|[\w.+-]*xml|javascript|x-www-form-urlencoded))\b/i.test(contentType) || !contentType
      if (textual) {
        const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] || 'utf-8'
        try { output = new TextDecoder(charset, { fatal: true, ignoreBOM: true }).decode(buffer, { stream: truncated }) }
        catch { bodyEncoding = 'base64' }
      } else bodyEncoding = 'base64'
      if (bodyEncoding === 'base64') output = buffer.toString('base64')
      const responseHeaders = [...response.headers].filter(([name]) => name !== 'set-cookie').map(([name, value]) => ({ name, value }))
      for (const value of response.headers.getSetCookie()) responseHeaders.push({ name: 'set-cookie', value })
      return { url: url.href, method, status: response.status, statusText: response.statusText, headers: responseHeaders, body: output, bodyEncoding, bytes, truncated, durationMs: Math.round(performance.now() - started), contentType, redirects, notice }
    }
  } catch (error) {
    if (signal?.aborted) throw new RequestError('CANCELED', '请求已取消。')
    if (timedOut) throw new RequestError('TIMEOUT', `请求超过 ${input.timeoutMs / 1000} 秒，请检查服务或调整超时。`)
    if (error instanceof RequestError) throw error
    const code = (error as { cause?: { code?: string } })?.cause?.code || ''
    if (/CERT|TLS|SSL/.test(code)) throw new RequestError('NETWORK_ERROR', 'HTTPS 证书验证失败，请检查服务器证书及本机信任配置。')
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new RequestError('NETWORK_ERROR', '无法解析域名，请检查地址和网络。')
    if (code === 'ECONNREFUSED') throw new RequestError('NETWORK_ERROR', '连接被拒绝，请确认服务已启动，地址与端口正确。')
    throw new RequestError('NETWORK_ERROR', '请求未完成，请检查网络、地址或服务器连接。')
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
