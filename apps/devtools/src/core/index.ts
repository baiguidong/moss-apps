import type { Action, Inputs, Outputs, Base64Input } from '../contracts'
import { timestamp } from './timestamp'
import { aes } from './aes'
import { processJson } from './json'
import { checkedText, checkedOutput, utf8, decodeUtf8, toBase64, fromBase64 } from './encoding'
export function base64(input: Base64Input) {
  checkedText(input.input)
  if (typeof input.urlSafe !== 'boolean') throw new Error('请选择 Base64 编码类型。')
  if (!['encode', 'decode'].includes(input.operation)) throw new Error('请选择编解码方向。')
  return checkedOutput(input.operation === 'encode' ? toBase64(utf8(input.input), input.urlSafe) : decodeUtf8(fromBase64(input.input, input.urlSafe)))
}
export async function execute<K extends Action>(action: K, input: Inputs[K]): Promise<Outputs[K]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请输入有效的转换参数。')
  switch (action) {
    case 'timestamp.convert': return timestamp(input as Inputs['timestamp.convert']) as Outputs[K]
    case 'base64.convert': return base64(input as Inputs['base64.convert']) as Outputs[K]
    case 'json.process': return processJson(input as Inputs['json.process']) as Outputs[K]
    case 'aes.process': return await aes(input as Inputs['aes.process']) as Outputs[K]
    default: throw new Error('不支持的工具。')
  }
}
