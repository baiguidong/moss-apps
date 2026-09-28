export const MAX_INPUT_BYTES = 128 * 1024
const encoder = new TextEncoder()
export const utf8 = (value: string) => encoder.encode(value)
export function decodeUtf8(value: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value) }
  catch { throw new Error('解码结果不是有效的 UTF-8 文本。请确认内容和编码。') }
}
export function checkedText(value: unknown, name = '输入'): string {
  if (typeof value !== 'string') throw new Error(`${name}必须是文本。`)
  if (utf8(value).length > MAX_INPUT_BYTES) throw new Error(`${name}超过 128 KiB，请缩小内容后重试。`)
  return value
}
export function checkedOutput(text: string) {
  const bytes = utf8(text).length
  if (bytes > 512 * 1024) throw new Error('结果超过 512 KiB，请缩小输入后重试。')
  return { text, bytes }
}
export function toBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const result = btoa(binary)
  return urlSafe ? result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : result
}
export function fromBase64(value: string, urlSafe = false): Uint8Array<ArrayBuffer> {
  const text = value.replace(/[\t\n\r ]/g, '')
  if (!(urlSafe ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/).test(text)) {
    throw new Error(`不是有效的 ${urlSafe ? 'URL-safe ' : ''}Base64，请检查字符或切换编码类型。`)
  }
  const unpadded = text.replace(/=+$/, '')
  if (unpadded.length % 4 === 1 || (text.includes('=') && (text.length % 4 !== 0 || text.length - unpadded.length !== (4 - unpadded.length % 4) % 4))) {
    throw new Error('Base64 长度或末尾的 = 填充不正确。')
  }
  try {
    const binary = atob(unpadded.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    if (toBase64(bytes, urlSafe).replace(/=+$/, '') !== unpadded) throw new Error('non-canonical')
    return bytes
  } catch { throw new Error('Base64 内容不完整或包含无效的填充位。') }
}
export function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/\s/g, '')
  if (!/^(?:[0-9a-f]{2})*$/i.test(text)) throw new Error('Hex 必须由成对的十六进制字符组成，例如 0a1b2c。')
  return Uint8Array.from(text.match(/../g) || [], byte => parseInt(byte, 16))
}
export const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
