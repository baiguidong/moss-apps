import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import { artifactsRoot, listApps, optionValue, readJson, repoRoot, writeJson } from './lib.mjs'
import { fetchGitHubReleaseRecords } from './github-releases.mjs'

const argv = process.argv.slice(2)
const siteRoot = path.resolve(optionValue(argv, '--output') || path.join(repoRoot, 'site'))
const catalogBaseUrl = String(process.env.MOSS_APP_MARKET_BASE_URL || 'https://baiguidong.github.io/moss-apps').replace(/\/+$/, '')
const githubRepository = optionValue(argv, '--github-repository') || ''
const explicitRelease = optionValue(argv, '--release')

async function findFiles(root, suffix) {
  if (!fs.existsSync(root)) return []
  const output = []
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(entryPath)
      else if (entry.isFile() && entry.name.endsWith(suffix)) output.push(entryPath)
    }
  }
  await visit(root)
  return output.sort()
}

function validateRelease(record) {
  if (record?.schemaVersion !== 1 || !record?.app?.id || !semver.valid(record?.version?.version)) {
    throw new Error('Invalid App release metadata')
  }
  const artifact = record.version.artifact
  if (!artifact?.downloadUrl || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
    throw new Error(`Invalid artifact metadata for ${record.app.id}@${record.version.version}`)
  }
  if (new URL(artifact.downloadUrl).protocol !== 'https:') {
    throw new Error(`Artifact URL must use HTTPS: ${artifact.downloadUrl}`)
  }
  return record
}

const records = []
if (githubRepository) records.push(...await fetchGitHubReleaseRecords(githubRepository))
for (const filePath of await findFiles(artifactsRoot, '.release.json')) records.push(readJson(filePath))
if (explicitRelease) records.push(readJson(path.resolve(explicitRelease)))

const byApp = new Map()
for (const raw of records.map(validateRelease)) {
  const current = byApp.get(raw.app.id) || { app: raw.app, versions: new Map() }
  current.app = raw.app
  current.versions.set(raw.version.version, raw.version)
  byApp.set(raw.app.id, current)
}
if (!byApp.size) throw new Error('No App release metadata found')

await fsp.rm(siteRoot, { recursive: true, force: true })
await fsp.mkdir(path.join(siteRoot, 'v1', 'apps'), { recursive: true })
await fsp.mkdir(path.join(siteRoot, 'v1', 'assets'), { recursive: true })

const sourceApps = new Map(listApps().map((app) => [app.manifest.id, app]))
const summaries = []
for (const [appId, entry] of [...byApp.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const versions = [...entry.versions.values()].sort((left, right) => semver.rcompare(left.version, right.version))
  const latest = versions[0]
  const sourceApp = sourceApps.get(appId)
  let iconUrl = ''
  if (sourceApp?.manifest.icon) {
    const extension = path.extname(sourceApp.manifest.icon).toLowerCase() || '.png'
    const iconName = `${appId}${extension}`
    await fsp.copyFile(path.join(sourceApp.root, sourceApp.manifest.icon), path.join(siteRoot, 'v1', 'assets', iconName))
    iconUrl = `${catalogBaseUrl}/v1/assets/${iconName}`
  }
  const detailUrl = `${catalogBaseUrl}/v1/apps/${appId}.json`
  const detail = {
    schemaVersion: 1,
    ...entry.app,
    iconUrl,
    latestVersion: latest.version,
    versions,
  }
  await writeJson(path.join(siteRoot, 'v1', 'apps', `${appId}.json`), detail)
  summaries.push({
    id: appId,
    displayName: entry.app.displayName,
    summary: entry.app.summary,
    publisher: entry.app.publisher,
    categories: entry.app.categories,
    featured: entry.app.featured,
    iconUrl,
    latestVersion: latest.version,
    latest,
    detailUrl,
  })
}

summaries.sort((left, right) => Number(right.featured) - Number(left.featured) || left.displayName.localeCompare(right.displayName, 'zh-CN'))
await writeJson(path.join(siteRoot, 'v1', 'index.json'), {
  schemaVersion: 1,
  catalogId: 'moss-official',
  displayName: 'Moss 应用市场',
  generatedAt: new Date().toISOString(),
  apps: summaries,
})
await writeJson(path.join(siteRoot, 'schemas', 'marketplace-v1.json'), readJson(path.join(repoRoot, 'schemas', 'marketplace.schema.json')))
console.log(`generated ${summaries.length} App entries in ${siteRoot}`)
