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
    if (bytes <= maxBytes) return value
    const resourceRef = createHash('sha256').update(text).digest('hex')
    const file = path.join(this.directory, resourceRef + '.json')
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file + '.tmp', text, {mode:0o600})
      fs.renameSync(file + '.tmp', file)
    }
    return { truncated: true, resourceRef, bytes, preview: text.slice(0, 2000) }
  }
  read(input: {resourceRef: string; offset?: number; limit?: number}) {
    if (!/^[a-f0-9]{64}$/.test(input.resourceRef)) throw new Error('Invalid resource reference')
    const text = fs.readFileSync(path.join(this.directory, input.resourceRef + '.json'), 'utf8')
    const offset = input.offset ?? 0, limit = Math.max(1, Math.min(input.limit ?? 32_000, 32_000))
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid resource offset')
    return { text: text.slice(offset, offset + limit), nextOffset: offset + limit < text.length ? offset + limit : null }
  }
}
