import { emptyPair, emptyRequest, METHODS, type Pair, type RequestInput, type Template } from '../contracts'

export function templateRequest(input: RequestInput): RequestInput {
  let url: URL
  try { url = new URL(input.url) } catch { throw new Error('请先填写完整的 HTTP(S) 地址。') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模板只支持 HTTP(S) 地址。')
  url.username = ''; url.password = ''; url.hash = ''
  const urlPairs = [...url.searchParams.keys()].map(name => ({ name, value: '', enabled: true }))
  url.search = ''
  const structure = (pairs: Pair[]) => pairs.filter(pair => pair.name).slice(0, 100).map(pair => ({ name: pair.name.slice(0, 256), value: '', enabled: pair.enabled }))
  const fallback = (pairs: Pair[]) => pairs.length ? pairs : [emptyPair()]
  return { ...emptyRequest(), method: input.method, url: url.href, query: fallback(structure([...urlPairs, ...input.query])), headers: fallback(structure(input.headers)), bodyMode: input.bodyMode, form: fallback(structure(input.form)), timeoutMs: input.timeoutMs, followRedirects: input.followRedirects }
}
export function readTemplates(raw: unknown): Template[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set<string>()
  return raw.slice(0, 50).flatMap(value => {
    try {
      if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.name.trim() || ids.has(value.id) || !METHODS.includes(value.request?.method)) return []
      const request = templateRequest(value.request)
      if (!['none', 'json', 'text', 'form'].includes(request.bodyMode) || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1000 || request.timeoutMs > 120000 || typeof request.followRedirects !== 'boolean') return []
      ids.add(value.id)
      return [{ id: value.id.slice(0, 128), name: value.name.slice(0, 80), request }]
    } catch { return [] }
  })
}
