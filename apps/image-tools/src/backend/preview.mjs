import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const maxPreviewBytes = 2 * 1024 * 1024
const maxInlineBytes = 600 * 1024

export async function previewImage(service, id) {
  const file = service.file(id)
  if (file.kind !== 'image') throw new Error('只能预览图片文件')
  const relative = path.join('previews', `${createHash('sha256').update(file.id).digest('hex')}.webp`)
  if (service.artifactUrl) {
    const cached = await fs.lstat(path.join(service.root, relative)).catch(() => null)
    if (cached?.isFile() && cached.size > 0 && cached.size <= maxPreviewBytes) {
      return { url: await service.artifactUrl(relative) }
    }
  }
  let source
  if (file.previewRelative) {
    try { source = await service.filePath({ relative: file.previewRelative }) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  source ||= await service.filePath(file)
  const render = (width, quality) => sharp(source, { limitInputPixels: 60_000_000 })
    .autoOrient().resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality }).toBuffer()
  let data = await render(1400, 76)
  if (data.length > maxPreviewBytes) data = await render(1000, 55)
  if (data.length > maxPreviewBytes) throw new Error('预览图片过大')
  if (service.artifactUrl) {
    const target = path.join(service.root, relative)
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    const temporary = `${target}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, data, { mode: 0o600 }); await fs.rename(temporary, target) }
    finally { await fs.rm(temporary, { force: true }) }
    return { url: await service.artifactUrl(relative) }
  }
  if (data.length > maxInlineBytes) data = await render(800, 48)
  if (data.length > maxInlineBytes) data = await render(500, 30)
  if (data.length > maxInlineBytes) throw new Error('预览图片过大')
  return { url: `data:image/webp;base64,${data.toString('base64')}` }
}
