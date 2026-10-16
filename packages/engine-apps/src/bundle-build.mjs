import fs from 'node:fs/promises'
import {createReadStream, constants} from 'node:fs'
import path from 'node:path'
import {createGzip} from 'node:zlib'
import {assetHash} from './bundled.mjs'

export async function bundleAsset(source, target, sha256, {partBytes = 64 * 1024 ** 2, threshold = 120 * 1024 ** 2} = {}) {
  if (!Number.isSafeInteger(partBytes) || partBytes < 1 || partBytes > 64 * 1024 ** 2) throw new Error('Invalid asset part size')
  if (await assetHash(source) !== sha256) throw new Error('Build asset checksum differs')
  await fs.mkdir(path.dirname(target), {recursive:true})
  const size = (await fs.stat(source)).size
  if (size <= threshold) { await fs.copyFile(source, target, constants.COPYFILE_FICLONE); return }
  const parts = []; let handle, written = 0
  async function close() {
    if (!handle) return
    await handle.close(); handle = null
    const file = target + `.part-${parts.length}`
    parts.push({size:written, sha256:await assetHash(file)}); written = 0
  }
  const input = createReadStream(source), compressed = input.pipe(createGzip({level:9}))
  input.on('error', error => compressed.destroy(error))
  try {
    for await (const chunk of compressed) {
      for (let offset = 0; offset < chunk.length;) {
        handle ||= await fs.open(target + `.part-${parts.length}`, 'w', 0o600)
        const count = Math.min(chunk.length - offset, partBytes - written)
        await handle.writeFile(chunk.subarray(offset, offset + count)); offset += count; written += count
        if (written === partBytes) await close()
      }
    }
    await close()
    await fs.writeFile(target + '.bundle.json', JSON.stringify({schemaVersion:1, size, sha256, parts}) + '\n')
  } finally { input.destroy(); compressed.destroy(); await handle?.close() }
}
