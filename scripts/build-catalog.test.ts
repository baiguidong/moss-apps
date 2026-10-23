import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

for (const [appId, listed] of [['moss.http-client', false], ['moss.devtools', true]] as const) test(`catalog ${listed ? 'includes' : 'excludes'} ${appId} from release metadata`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'moss-retired-catalog-'))
  try {
    const release = path.join(directory, 'http.release.json'), output = path.join(directory, 'site')
    await writeFile(release, JSON.stringify({
      schemaVersion: 1,
      app: { id: appId, displayName: appId, categories: ['开发工具'] },
      version: { version: '0.1.5', platforms: ['darwin-arm64'], artifact: { downloadUrl: 'https://example.com/http.zip', sha256: '0'.repeat(64) } },
    }))
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--release', release, '--artifacts', path.join(directory, 'empty'), '--output', output], {
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

  const fixture = await mkdtemp(path.join(os.tmpdir(), 'catalog-name-test-'))
  const output = await mkdtemp(path.join(os.tmpdir(), 'moss-catalog-name-'))
  try {
    for (const [file, version, displayName] of [['a', '99.0.1', '调用追踪'], ['z', '99.0.0', 'Trace']]) {
      await writeFile(path.join(fixture, `${file}.release.json`), JSON.stringify({ schemaVersion: 1,
        app: { id: 'moss.trace', displayName, categories: ['开发工具'] },
        version: { version, platforms: ['darwin-arm64'], artifact: { downloadUrl: 'https://example.com/test.zip', sha256: '0'.repeat(64) } },
      }))
    }
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--artifacts', fixture, '--output', output], { cwd: root, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const detail = JSON.parse(await readFile(path.join(output, 'v1/apps/moss.trace.json'), 'utf8'))
    expect(detail.displayName).toBe('调用追踪')
    expect(detail.latestVersion).toBe('99.0.1')
    // Old release metadata must not reintroduce generic/multiple categories.
    expect(detail.category).toBe('diagnostics')
    expect(detail.categories).toEqual(['诊断与安全'])
    expect(detail.keywords).toContain('Trace')
    const index = JSON.parse(await readFile(path.join(output, 'v1/index.json'), 'utf8'))
    expect(index.apps[0]).toMatchObject({ category: detail.category, categories: detail.categories, keywords: detail.keywords })
  } finally { await rm(fixture, { recursive: true, force: true }); await rm(output, { recursive: true, force: true }) }
})

test('catalog retains all same-version platform artifacts and a legacy metadata field', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'moss-platform-catalog-'))
  try {
    for (const platform of ['darwin-arm64', 'win32-x64']) {
      await writeFile(path.join(fixture, `${platform}.release.json`), JSON.stringify({ schemaVersion: 1,
        app: { id: 'moss.computer-use', displayName: '电脑操控', categories: ['效率'] },
        version: { version: '0.2.0', hostApi: '^3.3.0', permissions: ['desktop:control'], platforms: [platform],
          artifacts: { [platform]: { downloadUrl: `https://example.com/${platform}.zip`, sha256: '0'.repeat(64) } } },
      }))
    }
    const output = path.join(fixture, 'site')
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--artifacts', fixture, '--output', output], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const detail = JSON.parse(await readFile(path.join(output, 'v1/apps/moss.computer-use.json'), 'utf8'))
    expect(detail.versions).toHaveLength(1)
    expect(Object.keys(detail.versions[0].artifacts).sort()).toEqual(['darwin-arm64', 'win32-x64'])
    expect(detail.versions[0].artifact).toEqual(detail.versions[0].artifacts['darwin-arm64'])
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

test('catalog publishes config Apps with their resources and excludes prerelease versions', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'moss-mcp-catalog-'))
  try {
    for (const version of ['0.1.4', '0.2.0-beta.1']) await writeFile(path.join(fixture, `${version}.release.json`), JSON.stringify({ schemaVersion: 1,
      app: { id: 'moss.drawio', displayName: 'Draw.io' }, version: { version, platforms: ['darwin-arm64'],
        artifact: { downloadUrl: 'https://example.com/drawio.zip', sha256: '0'.repeat(64) } },
    }))
    const output = path.join(fixture, 'site')
    const result = spawnSync(process.execPath, ['scripts/build-catalog.mjs', '--artifacts', fixture, '--output', output], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const detail = JSON.parse(await readFile(path.join(output, 'v1/apps/moss.drawio.json'), 'utf8'))
    expect(detail.latestVersion).toBe('0.1.4')
    expect(detail.versions).toHaveLength(1)
    expect(detail.iconUrl).toContain('/assets/moss.drawio.svg')
    expect(await readFile(path.join(output, 'v1/assets/moss.drawio.svg'), 'utf8')).toContain('<svg')
  } finally { await rm(fixture, { recursive: true, force: true }) }
})
