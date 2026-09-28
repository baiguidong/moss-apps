import type { TimestampInput, TimestampResult } from '../contracts'
import { checkedText } from './encoding'
const zones = new Set(['local', 'UTC', '+08:00', '+09:00', '+01:00', '-05:00', '-08:00'])
function offset(zone: string): number {
  if (zone === 'UTC') return 0
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone)!
  return (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1)
}
const pad = (n: number, width = 2) => String(n).padStart(width, '0')
export function timestamp(input: TimestampInput): TimestampResult {
  const text = checkedText(input.input).trim()
  if (text.length > 100) throw new Error('日期或时间戳过长，请检查输入。')
  if (!zones.has(input.timezone)) throw new Error('请选择有效的时区。')
  let ms: number
  if (input.direction === 'timestamp') {
    if (!/^-?\d+(?:\.\d{1,3})?$/.test(text)) throw new Error('请输入数字时间戳；秒最多保留 3 位小数。')
    let unit = input.unit
    if (unit === 'auto') {
      const digits = text.replace(/^-/, '').split('.')[0]!.length
      if (digits === 13 && !text.includes('.')) unit = 'milliseconds'
      else if (digits === 10 || Number(text) === 0) unit = 'seconds'
      else throw new Error('自动识别支持 10 位秒或 13 位毫秒；其他长度请手动选择单位。')
    }
    if (!['seconds', 'milliseconds'].includes(unit)) throw new Error('请选择时间戳单位。')
    if (unit === 'milliseconds' && text.includes('.')) throw new Error('毫秒时间戳必须是整数。')
    // Decimal parsing avoids floating point rounding at millisecond boundaries.
    const negative = text.startsWith('-'), [whole, fraction = ''] = text.replace(/^-/, '').split('.')
    const value = BigInt(whole!) * (unit === 'seconds' ? 1000n : 1n) + (unit === 'seconds' ? BigInt(fraction.padEnd(3, '0')) : 0n)
    if (value > 8640000000000000n) throw new Error('时间戳超出支持的日期范围。')
    ms = Number(negative ? -value : value)
  } else if (input.direction === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text)
    if (!match) throw new Error('请使用 YYYY-MM-DD HH:mm:ss 格式，可在秒后添加 .SSS 毫秒。')
    const [, y, mo, d, h, mi, s = '0', f = '0'] = match
    const values = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(f.padEnd(3, '0'))]
    const date = new Date(0)
    if (input.timezone === 'local') {
      date.setFullYear(values[0]!, values[1]!, values[2]!)
      date.setHours(values[3]!, values[4]!, values[5]!, values[6]!)
    } else {
      date.setUTCFullYear(values[0]!, values[1]!, values[2]!)
      date.setUTCHours(values[3]!, values[4]!, values[5]!, values[6]!)
    }
    const actual = input.timezone === 'local'
      ? [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
      : [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()]
    if (actual.some((value, i) => value !== values[i])) throw new Error('日期不存在，请检查月份、天数和时间（含夏令时跳时）。')
    ms = date.getTime() - (input.timezone === 'local' ? 0 : offset(input.timezone) * 60000)
  } else throw new Error('请选择转换方向。')
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) throw new Error('日期超出支持范围。')
  const minutes = input.timezone === 'local' ? -date.getTimezoneOffset() : offset(input.timezone)
  const shifted = new Date(ms + minutes * 60000)
  if (!Number.isFinite(shifted.getTime())) throw new Error('该时区下的日期超出支持范围。')
  const zone = `UTC${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`
  const seconds = `${ms < 0 ? '-' : ''}${Math.floor(Math.abs(ms) / 1000)}${ms % 1000 ? '.' + pad(Math.abs(ms) % 1000, 3).replace(/0+$/, '') : ''}`
  return { seconds, milliseconds: String(ms), utc: date.toISOString(), timezone: zone,
    date: `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${pad(shifted.getUTCMilliseconds(), 3)}` }
}
