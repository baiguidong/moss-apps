import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

for (const [appId, listed] of [['moss.http-client', false], ['moss.devtools', true]] as const) test(`catalog ${listed ? 'includes' : 'excludes'} ${appId} from release metadata`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'moss-retired-catalog-'))
  try {
    const release = path.join(directory, 'http.release.json'), output = path.join(directory, 'site')
    await writeFile(release, JSON.stringify({
      schemaVersion: 1,
      app: { id: appId, displayName: appId, categories: ['开发工具'] },
      version: { version: '0.1.5', artifact: { downloadUrl: 'https://example.com/http.zip', sha256: '0'.repeat(64) } },
    }))
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--release', release, '--output', output], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    const catalog = JSON.parse(await readFile(path.join(output, 'v1/index.json'), 'utf8'))
    expect(catalog.apps.some((app: { id: string }) => app.id === appId)).toBe(listed)
    const detail = readFile(path.join(output, `v1/apps/${appId}.json`), 'utf8')
    if (listed) expect(JSON.parse(await detail).id).toBe(appId)
    else await expect(detail).rejects.toThrow()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('older release metadata cannot overwrite the latest Chinese display name', async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const fixture = await mkdtemp(path.join(root, 'artifacts/catalog-name-test-'))
  const output = await mkdtemp(path.join(os.tmpdir(), 'moss-catalog-name-'))
  try {
    for (const [file, version, displayName] of [['a', '99.0.1', '调用追踪'], ['z', '99.0.0', 'Trace']]) {
      await writeFile(path.join(fixture, `${file}.release.json`), JSON.stringify({ schemaVersion: 1,
        app: { id: 'moss.trace', displayName, categories: ['开发工具'] },
        version: { version, artifact: { downloadUrl: 'https://example.com/test.zip', sha256: '0'.repeat(64) } },
      }))
    }
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--output', output], { cwd: root, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const detail = JSON.parse(await readFile(path.join(output, 'v1/apps/moss.trace.json'), 'utf8'))
    expect(detail.displayName).toBe('调用追踪')
    expect(detail.latestVersion).toBe('99.0.1')
  } finally { await rm(fixture, { recursive: true, force: true }); await rm(output, { recursive: true, force: true }) }
})
