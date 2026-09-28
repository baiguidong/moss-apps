import { describe, expect, test } from 'bun:test'
import { createCipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compileJsonSchema, validateAppManifest } from '@moss/app-sdk'
import { execute, base64 } from '../src/core'
import { timestamp } from '../src/core/timestamp'
import { processJson } from '../src/core/json'
import { aes } from '../src/core/aes'
import type { AesInput, TimestampInput } from '../src/contracts'
const time: TimestampInput = { direction: 'timestamp', input: '1704067200', unit: 'auto', timezone: '+08:00' }
const aesInput: AesInput = { operation: 'encrypt', mode: 'GCM', input: '', key: '00'.repeat(16), keyEncoding: 'hex', iv: '00'.repeat(12), ivEncoding: 'hex', outputEncoding: 'hex' }
describe('timestamps', () => {
  test('seconds and milliseconds map to the same date, UTC and chosen offset', () => {
    expect(timestamp(time)).toEqual({ seconds: '1704067200', milliseconds: '1704067200000', utc: '2024-01-01T00:00:00.000Z', date: '2024-01-01 08:00:00.000', timezone: 'UTC+08:00' })
    expect(timestamp({ ...time, input: '1704067200000' })).toEqual(timestamp(time))
  })
  test('preserves positive/negative millisecond precision and epoch zero', () => {
    for (const value of ['1704067200.123', '-0.001', '-1.001', '0', '999.999']) {
      const result = timestamp({ ...time, input: value, unit: 'seconds' })
      expect(result.seconds).toBe(value)
      expect(timestamp({ ...time, direction: 'date', input: result.date })).toEqual(result)
    }
  })
  test('date conversion uses explicit timezone, including year 0099 and leap day', () => {
    expect(timestamp({ ...time, direction: 'date', input: '2024-01-01 08:00:00.123' }).milliseconds).toBe('1704067200123')
    expect(timestamp({ ...time, direction: 'date', input: '0099-01-01 00:00', timezone: 'UTC' }).utc).toBe('0099-01-01T00:00:00.000Z')
    expect(timestamp({ ...time, direction: 'date', input: '2024-02-29 23:59:59.999', timezone: '-05:00' }).utc).toBe('2024-03-01T04:59:59.999Z')
  })
  test('rejects impossible dates, ambiguous units, excessive precision and range', () => {
    for (const input of ['2023-02-29 12:00:00', '2024-13-01 00:00', '2024-01-01 24:00', '2024-00-01 00:00', '2024-01-00 00:00']) expect(() => timestamp({ ...time, direction: 'date', input })).toThrow()
    for (const input of ['123', '1e10', 'Infinity', '8640000000000001', '1.0001']) expect(() => timestamp({ ...time, input })).toThrow()
    expect(() => timestamp({ ...time, unit: 'milliseconds', input: '1.5' })).toThrow()
    expect(() => timestamp({ ...time, input: '9'.repeat(1000) })).toThrow()
  })
})
describe('Base64', () => {
  test('roundtrips Unicode and whitespace without silent text changes', () => {
    for (const input of ['', 'hello', '你好，Moss 👋\n', '\0text\r\n', '\uFEFFhello']) {
      const encoded = base64({ input, operation: 'encode', urlSafe: false })
      expect(encoded.text).toBe(Buffer.from(input).toString('base64'))
      expect(base64({ input: encoded.text, operation: 'decode', urlSafe: false }).text).toBe(input)
    }
  })
  test('URL-safe alphabet, omitted padding and whitespace in encoded input', () => {
    const input = '🧑‍💻 你好'
    const encoded = base64({ input, operation: 'encode', urlSafe: true }).text
    expect(encoded).toBe(Buffer.from(input).toString('base64url'))
    expect(base64({ input: encoded, operation: 'decode', urlSafe: true }).text).toBe(input)
    expect(base64({ input: ' aG Vs\nbG8=\r\n', operation: 'decode', urlSafe: false }).text).toBe('hello')
  })
  test('rejects noncanonical padding, invalid UTF-8 and oversized content', () => {
    for (const input of ['a', 'aG=', 'aG===', 'aGVsbG8===', 'Zg=', 'Zh==', '%%%']) expect(() => base64({ input, operation: 'decode', urlSafe: false })).toThrow()
    expect(() => base64({ input: '/w==', operation: 'decode', urlSafe: false })).toThrow('UTF-8')
    expect(() => base64({ input: '中'.repeat(50000), operation: 'encode', urlSafe: false })).toThrow('128 KiB')
  })
})
describe('JSON', () => {
  test('format/minify preserve large numbers, exponent spelling, negative zero, keys and strings', () => {
    const input = '{"id":9007199254740993,"n":-0,"e":1.20e+100,"s":"a b \\u4e2d","a":[true,null]}'
    const formatted = processJson({ input, operation: 'format', indent: '2' })
    expect(formatted.text).toContain('9007199254740993')
    expect(formatted.text).toContain('1.20e+100')
    expect(processJson({ input: formatted.text, operation: 'minify', indent: '2' }).text).toBe(input)
    expect(processJson({ input, operation: 'format', indent: 'tab' }).text).toContain('\n\t"id"')
    expect(processJson({ input: '[1,2]', operation: 'validate', indent: '2' }).text).toBe('[1,2]')
  })
  test('reports line and column; rejects comments, trailing commas, extra tokens and nesting', () => {
    for (const input of ['{\n "x":\n}', '{"x":1,}', '{/*a*/"x":1}', '{"x":NaN}', '{"x":01}', '[] []', '"bad\\x"']) expect(() => processJson({ input, operation: 'format', indent: '2' })).toThrow(/第 \d+ 行，第 \d+ 列/)
    expect(() => processJson({ input: '['.repeat(129) + '0' + ']'.repeat(129), operation: 'format', indent: '2' })).toThrow('128 层')
    expect(() => processJson({ input: '', operation: 'format', indent: '2' })).toThrow('请先输入')
  })
})
describe('AES native Crypto', () => {
  test('matches NIST AES-128 GCM empty and one-block vectors with a 128-bit tag', async () => {
    expect((await aes(aesInput)).text).toBe('58e2fccefa7e3061367f1d57a4e7455a')
    const encrypted = await aes({ ...aesInput, input: '\0'.repeat(16) })
    expect(encrypted.text).toBe('0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf')
    expect((await aes({ ...aesInput, operation: 'decrypt', input: encrypted.text })).text).toBe('\0'.repeat(16))
  })
  test('CBC matches Node crypto with PKCS#7 and preserves Unicode', async () => {
    for (const length of [16, 24, 32]) {
      const key = Buffer.alloc(length, 7), iv = Buffer.alloc(16, 3), input = '你好 Moss 👋'
      const cipher = createCipheriv(`aes-${length * 8}-cbc`, key, iv)
      const expected = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]).toString('base64')
      const options: AesInput = { ...aesInput, mode: 'CBC', key: key.toString('base64'), keyEncoding: 'base64', iv: iv.toString('base64'), ivEncoding: 'base64', outputEncoding: 'base64', input }
      expect((await aes(options)).text).toBe(expected)
      expect((await aes({ ...options, operation: 'decrypt', input: expected })).text).toBe(input)
    }
  })
  test('automatic IV changes for each encryption and supports raw UTF-8 keys', async () => {
    const options: AesInput = { ...aesInput, key: '1234567890abcdef', keyEncoding: 'utf8', iv: '', input: 'same input' }
    const first = await aes(options), second = await aes(options)
    expect(first.iv).not.toBe(second.iv)
    expect(first.text).not.toBe(second.text)
    expect((await aes({ ...options, operation: 'decrypt', input: first.text, iv: first.iv })).text).toBe(options.input)
  })
  test('rejects wrong key length, IV, encoding, changed ciphertext and authentication tag', async () => {
    for (const patch of [{ key: 'ff' }, { iv: 'ff' }, { key: 'xx'.repeat(16) }, { operation: 'decrypt' as const, iv: '' }, { operation: 'decrypt' as const, input: '00' }]) await expect(aes({ ...aesInput, ...patch })).rejects.toThrow()
    const result = await aes({ ...aesInput, input: 'hello' })
    await expect(aes({ ...aesInput, operation: 'decrypt', input: 'ff' + result.text.slice(2) })).rejects.toThrow('解密失败')
    await expect(aes({ ...aesInput, operation: 'decrypt', input: result.text.slice(0, -2) + (result.text.endsWith('ff') ? '00' : 'ff') })).rejects.toThrow('解密失败')
  })
})
test('published contracts validate results, reject extra fields and expose only declared tools', async () => {
  const manifest = validateAppManifest(JSON.parse(readFileSync(new URL('../app.moss.json', import.meta.url), 'utf8')))
  const samples = { 'timestamp.convert': time, 'base64.convert': { operation: 'encode', input: 'hello', urlSafe: false }, 'json.process': { operation: 'format', input: '{"x":1}', indent: '2' }, 'aes.process': aesInput }
  expect(manifest.permissions).toEqual([])
  expect(manifest.contributes!.tools).toHaveLength(4)
  for (const action of manifest.backend!.actions) {
    const inputSchema = JSON.parse(readFileSync(new URL('../' + action.inputSchema, import.meta.url), 'utf8'))
    const outputSchema = JSON.parse(readFileSync(new URL('../' + action.outputSchema, import.meta.url), 'utf8'))
    const input = samples[action.name as keyof typeof samples]
    const validateInput = compileJsonSchema(inputSchema, { removeAdditional: false }), validateOutput = compileJsonSchema(outputSchema)
    expect(validateInput(input)).toBe(true)
    expect(validateInput({ ...input, unexpected: true })).toBe(false)
    expect(validateOutput(await execute(action.name as any, input as any))).toBe(true)
  }
  await expect(execute('unknown' as any, {} as any)).rejects.toThrow('不支持')
})
