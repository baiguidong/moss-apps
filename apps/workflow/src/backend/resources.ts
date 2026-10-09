import { readUtf16Range } from '@moss/app-sdk/results/store'
import { RESULT_LIMITS } from '@moss/app-sdk/results'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
/** Content-addressed JSON, independent of transport frames. Offsets are UTF-16 code units. */
export class Resources {
  constructor(private directory: string) { fs.mkdirSync(directory, {recursive:true}) }
  bound(value: any, maxBytes = 16_384): any {
    if (value === undefined) return undefined
    const text = JSON.stringify(value)
    const bytes = Buffer.byteLength(text)
    if (bytes > RESULT_LIMITS.maxBytes) throw new Error('Resource exceeds 32 MiB')
    if (bytes <= maxBytes) return value
    const resourceRef = createHash('sha256').update(text).digest('hex')
    const file = path.join(this.directory, resourceRef + '.utf16')
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file + '.tmp', text, {mode:0o600,encoding:'utf16le'})
      fs.renameSync(file + '.tmp', file)
    }
    return { truncated: true, resourceRef, bytes, preview: text.slice(0, 2000) }
  }
  read(input: {resourceRef: string; offset?: number; limit?: number}) {
    if (!/^[a-f0-9]{64}$/.test(input.resourceRef)) throw new Error('Invalid resource reference')
    return readUtf16Range(path.join(this.directory, input.resourceRef + '.utf16'), input.offset, input.limit)
  }
}
