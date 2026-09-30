import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
const MAX_MIRROR_BYTES = 90 * 1024 * 1024

// Preserve the signed release bytes; only the catalog delivery URL changes.
export async function mirrorCatalogArtifact(appId, version, { siteRoot, artifactsRoot, catalogBaseUrl, fetchImpl = fetch }) {
  const artifact = version.artifact
  if (!artifact?.signed) throw new Error(`Refusing to mirror an unsigned App: ${appId}`)
  for (const segment of [appId, version.version, artifact.fileName]) {
    if (typeof segment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(segment)) throw new Error('Invalid artifact path')
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_MIRROR_BYTES) throw new Error('Artifact exceeds catalog hosting size limit')
  let buffer
  const local = path.join(artifactsRoot, appId, version.version, artifact.fileName)
  try {
    if ((await fs.stat(local)).size !== artifact.size) throw new Error('Local artifact size mismatch')
    buffer = await fs.readFile(local)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const url = new URL(artifact.downloadUrl)
    if (url.protocol !== 'https:') throw new Error('Artifact download must use HTTPS')
    const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Unable to mirror ${appId}@${version.version}: HTTP ${response.status}`)
    const parts = []; let bytes = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.length
        if (bytes > artifact.size) throw new Error('Downloaded artifact size mismatch')
        parts.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    buffer = Buffer.concat(parts)
  }
  if (buffer.length !== artifact.size) throw new Error('Artifact size mismatch')
  if (createHash('sha256').update(buffer).digest('hex') !== artifact.sha256) throw new Error('Artifact checksum mismatch')
  const segments = ['v1', 'packages', appId, version.version, artifact.fileName]
  const target = path.join(siteRoot, ...segments)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, buffer)
  return { ...version, artifact: { ...artifact, downloadUrl: `${catalogBaseUrl.replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}` } }
}
