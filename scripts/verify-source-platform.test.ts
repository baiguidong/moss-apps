import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { attachSourcePackage } from '../vendor/moss-core/packages/app-runtime/src/packages/source.mjs'
import { writePackageChecksums } from '../vendor/moss-core/packages/app-runtime/src/packages/index.mjs'
import { createDeterministicZip } from './archive.mjs'
import { verifySourceArchive } from './verify-source-package.mjs'

test('foreign native archives retain integrity checks without executing incompatible code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-native-archive-'))
  const host = `${process.platform}-${process.arch}`
  const foreign = host === 'linux-x64' ? 'darwin-arm64' : 'linux-x64'
  async function fixture(platform: string) {
    const source = path.join(root, platform, 'input'), pkg = path.join(root, platform, 'package')
    await fs.mkdir(path.join(source, 'src'), { recursive: true })
    await fs.mkdir(path.join(pkg, 'dist'), { recursive: true })
    const manifest = { schemaVersion: 2, id: 'example.native', version: '1.0.0', displayName: 'Native fixture', hostApi: '^3.3.0', permissions: [], platforms: [platform], backend: { entry: 'dist/main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: [] } }
    const code = "throw new Error('native-platform-sentinel')\n"
    for (const directory of [source, pkg]) await fs.writeFile(path.join(directory, 'app.moss.json'), JSON.stringify(manifest))
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'native-fixture', packageManager: 'bun@1.3.10', scripts: { build: 'node build.mjs' } }))
    await fs.writeFile(path.join(source, 'src/main.mjs'), code)
    await fs.writeFile(path.join(source, 'build.mjs'), '// Fixture; rebuild must be rejected on a foreign platform.\n')
    await fs.writeFile(path.join(pkg, 'dist/main.mjs'), code)
    await attachSourcePackage(pkg, source)
    const checksums = await writePackageChecksums(pkg)
    const entries = Object.fromEntries(await Promise.all([...Object.keys(checksums), 'checksums.json'].map(async name => [name, await fs.readFile(path.join(pkg, name))])))
    const archive = path.join(root, `${platform}.zip`)
    await fs.writeFile(archive, createDeterministicZip(entries))
    return { archive, entries }
  }
  try {
    const { archive, entries } = await fixture(foreign)
    expect((await verifySourceArchive(archive)).platforms).toEqual([foreign])
    await expect(verifySourceArchive(archive, { rebuild: true })).rejects.toThrow('requires a supported platform')
    await expect(verifySourceArchive(archive, { requireSignature: true })).rejects.toThrow()
    entries['dist/main.mjs'] = Buffer.from('tampered')
    await fs.writeFile(archive, createDeterministicZip(entries))
    await expect(verifySourceArchive(archive)).rejects.toThrow(/checksum|integrity|mismatch/i)
    await expect(verifySourceArchive((await fixture(host)).archive)).rejects.toThrow('native-platform-sentinel')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
