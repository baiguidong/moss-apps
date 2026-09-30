import { test, expect } from 'bun:test'
import { mkdtemp, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { mirrorCatalogArtifact } from './catalog-artifacts.mjs'
const buffer = Buffer.from('immutable signed zip fixture')
const version = { version: '0.1.1', artifact: { fileName: 'moss.library-0.1.1.zip', signed: true, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), downloadUrl: 'https://github.com/example/release.zip' } }
test('catalog mirror preserves release checksum, signature metadata and bytes while replacing only delivery URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moss-catalog-artifacts-'))
  try {
    const options = { siteRoot: path.join(root, 'site'), artifactsRoot: path.join(root, 'artifacts'), catalogBaseUrl: 'https://example.org/apps', fetchImpl: async () => new Response(buffer) }
    const result = await mirrorCatalogArtifact('moss.library', version, options)
    expect(result.artifact.downloadUrl).toBe('https://example.org/apps/v1/packages/moss.library/0.1.1/moss.library-0.1.1.zip')
    expect(result.artifact.sha256).toBe(version.artifact.sha256)
    expect(result.artifact.signed).toBe(true)
    expect(version.artifact.downloadUrl).toBe('https://github.com/example/release.zip')
    expect(await readFile(path.join(options.siteRoot, 'v1/packages/moss.library/0.1.1/moss.library-0.1.1.zip'))).toEqual(buffer)
    const local = path.join(options.artifactsRoot, 'moss.library/0.1.1/moss.library-0.1.1.zip')
    await mkdir(path.dirname(local), { recursive: true }); await writeFile(local, buffer)
    await mirrorCatalogArtifact('moss.library', version, { ...options, fetchImpl: async () => { throw new Error('local release should not download again') } })
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('catalog mirror rejects corruption, truncated downloads, unsigned releases and unsafe paths before publishing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moss-catalog-artifacts-'))
  try {
    const options = { siteRoot: path.join(root, 'site'), artifactsRoot: path.join(root, 'artifacts'), catalogBaseUrl: 'https://example.org/apps', fetchImpl: async () => new Response(buffer) }
    await expect(mirrorCatalogArtifact('moss.library', { ...version, artifact: { ...version.artifact, sha256: '0'.repeat(64) } }, options)).rejects.toThrow('checksum')
    await expect(mirrorCatalogArtifact('moss.library', version, { ...options, fetchImpl: async () => new Response('short') })).rejects.toThrow('size')
    await expect(mirrorCatalogArtifact('moss.library', version, { ...options, fetchImpl: async () => new Response(Buffer.alloc(buffer.length + 1)) })).rejects.toThrow('size')
    await expect(mirrorCatalogArtifact('moss.library', { ...version, artifact: { ...version.artifact, signed: false } }, options)).rejects.toThrow('unsigned')
    await expect(mirrorCatalogArtifact('../escape', version, options)).rejects.toThrow('path')
    await expect(stat(options.siteRoot)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
