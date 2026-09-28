import type { AesInput, AesResult } from '../contracts'
import { checkedOutput, checkedText, decodeUtf8, fromBase64, fromHex, toBase64, toHex, utf8 } from './encoding'
export async function aes(input: AesInput): Promise<AesResult> {
  checkedText(input.input); checkedText(input.key, '密钥'); checkedText(input.iv, 'IV')
  if (!['encrypt', 'decrypt'].includes(input.operation) || !['GCM', 'CBC'].includes(input.mode)) throw new Error('请选择有效的 AES 操作和模式。')
  if (!['hex', 'base64', 'utf8'].includes(input.keyEncoding) || !['hex', 'base64'].includes(input.ivEncoding) || !['hex', 'base64'].includes(input.outputEncoding)) throw new Error('请选择有效的编码。')
  const keyBytes = input.keyEncoding === 'utf8' ? utf8(input.key) : input.keyEncoding === 'hex' ? fromHex(input.key) : fromBase64(input.key)
  if (![16, 24, 32].includes(keyBytes.length)) throw new Error(`密钥需要 16、24 或 32 字节，当前为 ${keyBytes.length} 字节。`)
  const ivSize = input.mode === 'GCM' ? 12 : 16
  const iv = input.iv.trim() ? (input.ivEncoding === 'hex' ? fromHex(input.iv) : fromBase64(input.iv))
    : input.operation === 'encrypt' ? crypto.getRandomValues(new Uint8Array(ivSize)) : new Uint8Array()
  if (iv.length !== ivSize) throw new Error(`${input.mode} 的 IV 需要 ${ivSize} 字节，请填入加密时使用的 IV。`)
  const cipher = input.outputEncoding === 'hex' ? fromHex : fromBase64
  const data = input.operation === 'encrypt' ? utf8(input.input) : cipher(input.input)
  if (input.operation === 'decrypt' && (input.mode === 'GCM' ? data.length < 16 : data.length === 0 || data.length % 16 !== 0)) throw new Error('密文长度不正确，请确认密文、编码和 AES 模式。')
  let result: ArrayBuffer
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, `AES-${input.mode}`, false, [input.operation])
    const algorithm = input.mode === 'GCM' ? { name: 'AES-GCM', iv, tagLength: 128 } : { name: 'AES-CBC', iv }
    result = input.operation === 'encrypt' ? await crypto.subtle.encrypt(algorithm, key, data) : await crypto.subtle.decrypt(algorithm, key, data)
  } catch {
    throw new Error(input.operation === 'decrypt' ? '解密失败，请检查密钥、IV、密文、编码和模式是否与加密时一致。' : '加密失败，请检查参数后重试。')
  }
  const bytes = new Uint8Array(result)
  const text = input.operation === 'decrypt' ? decodeUtf8(bytes) : input.outputEncoding === 'hex' ? toHex(bytes) : toBase64(bytes)
  return { ...checkedOutput(text), iv: input.ivEncoding === 'hex' ? toHex(iv) : toBase64(iv), ivEncoding: input.ivEncoding, mode: input.mode }
}
