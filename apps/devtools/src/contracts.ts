export type Encoding = 'hex' | 'base64'
export type TimeZone = 'local' | 'UTC' | '+08:00' | '+09:00' | '+01:00' | '-05:00' | '-08:00'
export type TimestampInput = { direction: 'timestamp' | 'date'; input: string; unit: 'auto' | 'seconds' | 'milliseconds'; timezone: TimeZone }
export type TimestampResult = { seconds: string; milliseconds: string; utc: string; date: string; timezone: string }
export type Base64Input = { operation: 'encode' | 'decode'; input: string; urlSafe: boolean }
export type TextResult = { text: string; bytes: number }
export type JsonInput = { operation: 'format' | 'minify' | 'validate'; input: string; indent: '2' | '4' | 'tab' }
export type JsonResult = TextResult & { message: string }
export type AesInput = { operation: 'encrypt' | 'decrypt'; mode: 'GCM' | 'CBC'; input: string; key: string; keyEncoding: Encoding | 'utf8'; iv: string; ivEncoding: Encoding; outputEncoding: Encoding }
export type AesResult = TextResult & { iv: string; ivEncoding: Encoding; mode: 'GCM' | 'CBC' }
export type Inputs = { 'timestamp.convert': TimestampInput; 'base64.convert': Base64Input; 'json.process': JsonInput; 'aes.process': AesInput }
export type Outputs = { 'timestamp.convert': TimestampResult; 'base64.convert': TextResult; 'json.process': JsonResult; 'aes.process': AesResult }
export type Action = keyof Inputs
export type Invoke = <K extends Action>(action: K, input: Inputs[K]) => Promise<Outputs[K]>
