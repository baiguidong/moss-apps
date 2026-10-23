import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import yauzl from 'yauzl'
import { createDeterministicZip, findExecutablePaths } from './archive.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('release ZIP bytes are reproducible across runner time zones', () => {
  const moduleUrl = new URL('./archive.mjs', import.meta.url).href
  const source = `import { createDeterministicZip } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(createDeterministicZip({ 'app.moss.json': Buffer.from('fixture') }));`
  const archives = ['UTC', 'America/Los_Angeles', 'Asia/Shanghai'].map(TZ =>
    execFileSync('node', ['--input-type=module', '-e', source], { env: { ...process.env, TZ } }))
  expect(archives[1]).toEqual(archives[0])
  expect(archives[2]).toEqual(archives[0])
  expect(Buffer.from(unzipSync(archives[0])['app.moss.json']).toString()).toBe('fixture')
})

test('npm bin metadata preserves native execution when building on a filesystem without executable bits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-bin-metadata-'))
  try {
    const entries = {
      'runtime/node_modules/@dbx-app/native/package.json': JSON.stringify({ bin: { dbx: 'bin/dbx-mcp', escape: '../../../mcp.json' } }),
      'runtime/node_modules/@dbx-app/native/bin/dbx-mcp': 'binary',
      'runtime/node_modules/@dbx-app/launcher/package.json': JSON.stringify({ bin: 'bin/launch.js' }),
      'runtime/node_modules/@dbx-app/launcher/bin/launch.js': 'launcher',
      'mcp.json': '{}',
    }
    const files = []
    for (const [relativePath, content] of Object.entries(entries)) {
      const absolutePath = path.join(root, relativePath)
      await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      await fs.writeFile(absolutePath, content, { mode: 0o600 })
      files.push({ relativePath, absolutePath })
    }
    expect(await findExecutablePaths(files)).toEqual([
      'runtime/node_modules/@dbx-app/launcher/bin/launch.js',
      'runtime/node_modules/@dbx-app/native/bin/dbx-mcp',
    ])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('ZIP records private executable permissions only for declared executables', async () => {
  const entries = { 'runtime/dbx-mcp': Buffer.from('binary'), 'mcp.json': Buffer.from('{}') }
  const archive = createDeterministicZip(entries, { executablePaths: ['runtime/dbx-mcp'] })
  const modes = await new Promise<Record<string, number>>((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return }
      const result: Record<string, number> = {}
      zip.on('error', reject)
      zip.on('entry', entry => { result[entry.fileName] = (entry.externalFileAttributes >>> 16) & 0o777; zip.readEntry() })
      zip.on('end', () => resolve(result))
      zip.readEntry()
    })
  })
  expect(modes['runtime/dbx-mcp']).toBe(0o700)
  expect(modes['mcp.json'] & 0o111).toBe(0)
  expect(Buffer.from(unzipSync(archive)['runtime/dbx-mcp']).toString()).toBe('binary')
})
