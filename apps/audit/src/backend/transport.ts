import { randomUUID } from 'node:crypto'
/** Chunk large prompts/results below the App IPC envelope limit. */
export function createResultTransport() {
  const results = new Map<string, { bytes: Buffer; expires: number }>()
  const prune = () => { for (const [id, entry] of results) if (entry.expires < Date.now()) results.delete(id) }
  return {
    pack(value: unknown) {
      prune()
      const bytes = Buffer.from(JSON.stringify(value))
      if (bytes.length <= 256 * 1024) return { value }
      if (bytes.length > 32 * 1024 * 1024) throw new Error('结果超过 32 MB，请缩小查询范围。')
      if ([...results.values()].reduce((total, item) => total + item.bytes.length, bytes.length) > 64 * 1024 * 1024) throw new Error('正在读取的记录较多，请稍后重试。')
      const id = randomUUID()
      results.set(id, { bytes, expires: Date.now() + 60_000 })
      return { transfer: { id, size: bytes.length } }
    },
    read(input: { id: string; offset: number }) {
      prune()
      const entry = results.get(input.id)
      if (!entry) throw new Error('结果已过期，请重新打开。')
      if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset >= entry.bytes.length) throw new Error('无效的读取位置。')
      entry.expires = Date.now() + 60_000
      const chunk = entry.bytes.subarray(input.offset, input.offset + 256 * 1024)
      return { data: chunk.toString('base64'), nextOffset: input.offset + chunk.length, done: input.offset + chunk.length >= entry.bytes.length }
    },
    release(id: string) { results.delete(id); return { released: true } },
    close() { results.clear() },
  }
}
