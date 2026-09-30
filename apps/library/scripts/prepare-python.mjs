import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import JSZip from 'jszip'

export async function preparePython(destination) {
  const wheel = 'pypdf-6.1.1-py3-none-any.whl'
  const url = `https://files.pythonhosted.org/packages/07/ed/adae13756d9dabdddee483fc7712905bb5585fbf6e922b1a19aca3a29cd1/${wheel}`
  const digest = '7781f99493208a37a7d4275601d883e19af24e62a525c25844d22157c2e4cde7'
  const cache = path.join(fileURLToPath(new URL('..', import.meta.url)), '.cache', wheel)
  await mkdir(path.dirname(cache), { recursive: true })
  let buffer
  try { buffer = await readFile(cache) } catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`pypdf download failed: ${response.status}`)
    buffer = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(buffer).digest('hex') !== digest) throw new Error('pypdf SHA-256 mismatch')
  await writeFile(cache, buffer)
  await mkdir(destination, { recursive: true })
  const zip = await JSZip.loadAsync(buffer)
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !(name.startsWith('pypdf/') || name.startsWith('pypdf-6.1.1.dist-info/'))) continue
    if (name.split('/').some(part => part === '..') || path.isAbsolute(name)) throw new Error('Invalid wheel path')
    const target = path.join(destination, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, await entry.async('nodebuffer'))
  }
}
