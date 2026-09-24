import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAppManifest } from '@moss/app-sdk'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const appsRoot = path.join(repoRoot, 'apps')
export const artifactsRoot = path.join(repoRoot, 'artifacts')

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function validateRepositoryAppManifest(rawManifest) {
  const backend = rawManifest?.backend
  if (backend && typeof backend === 'object') {
    for (const field of ['targets', 'serverOwnerScope']) {
      if (Object.hasOwn(backend, field)) {
        throw new Error(`App ${rawManifest.id} must not declare backend.${field}; App Backends run only in Moss Desktop`)
      }
    }
    if (Array.isArray(backend.protocols) && backend.protocols.includes('moss.remote/v1')) {
      throw new Error(`App ${rawManifest.id} must not declare moss.remote/v1; App Backends run only in Moss Desktop`)
    }
  }
  return validateAppManifest(rawManifest)
}

export async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function optionValue(argv, name) {
  const direct = argv.find((entry) => entry.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

export function hasOption(argv, name) {
  return argv.includes(name)
}

export function validateMarketplaceMetadata(raw, manifest, sourcePath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid marketplace metadata: ${sourcePath}`)
  }
  const allowed = new Set([
    'schemaVersion', 'appId', 'summary', 'description', 'categories', 'keywords',
    'platforms', 'homepage', 'repository', 'license', 'featured', 'screenshots',
  ])
  const unknown = Object.keys(raw).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`Unknown marketplace property ${unknown}: ${sourcePath}`)
  if (raw.schemaVersion !== 1) throw new Error(`marketplace.schemaVersion must be 1: ${sourcePath}`)
  if (raw.appId !== manifest.id) throw new Error(`marketplace.appId must equal ${manifest.id}: ${sourcePath}`)
  if (!String(raw.summary || '').trim() || String(raw.summary).length > 160) {
    throw new Error(`marketplace.summary must contain 1-160 characters: ${sourcePath}`)
  }
  for (const field of ['categories', 'platforms']) {
    if (!Array.isArray(raw[field]) || raw[field].length === 0 || raw[field].some((item) => !String(item || '').trim())) {
      throw new Error(`marketplace.${field} must be a non-empty string array: ${sourcePath}`)
    }
  }
  const supportedPlatforms = new Set([
    'darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64',
  ])
  const unsupported = raw.platforms.find((item) => !supportedPlatforms.has(item))
  if (unsupported) throw new Error(`Unsupported marketplace platform ${unsupported}: ${sourcePath}`)
  for (const field of ['homepage', 'repository']) {
    if (!raw[field]) continue
    const url = new URL(raw[field])
    if (url.protocol !== 'https:') throw new Error(`marketplace.${field} must use HTTPS: ${sourcePath}`)
  }
  if (raw.screenshots !== undefined && !Array.isArray(raw.screenshots)) {
    throw new Error(`marketplace.screenshots must be an array: ${sourcePath}`)
  }
  return Object.freeze({
    schemaVersion: 1,
    appId: manifest.id,
    summary: String(raw.summary).trim(),
    description: String(raw.description || manifest.description || '').trim(),
    categories: [...new Set(raw.categories.map((item) => String(item).trim()))],
    keywords: [...new Set((raw.keywords || []).map((item) => String(item).trim()).filter(Boolean))],
    platforms: [...new Set(raw.platforms)],
    homepage: raw.homepage || '',
    repository: raw.repository || '',
    license: String(raw.license || '').trim(),
    featured: raw.featured === true,
    screenshots: (raw.screenshots || []).map((item) => ({
      path: String(item?.path || '').trim(),
      caption: String(item?.caption || '').trim(),
    })).filter((item) => item.path),
  })
}

export function listApps() {
  if (!fs.existsSync(appsRoot)) return []
  return fs.readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const root = path.join(appsRoot, entry.name)
      const manifestPath = path.join(root, 'app.moss.json')
      const marketplacePath = path.join(root, 'marketplace.json')
      if (!fs.existsSync(manifestPath)) return null
      const manifest = validateRepositoryAppManifest(readJson(manifestPath))
      if (!fs.existsSync(marketplacePath)) throw new Error(`Missing marketplace.json for ${manifest.id}`)
      const marketplace = validateMarketplaceMetadata(readJson(marketplacePath), manifest, marketplacePath)
      return { directoryName: entry.name, root, manifest, marketplace, manifestPath, marketplacePath }
    })
    .filter(Boolean)
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
}

export function selectApps(argv = process.argv.slice(2)) {
  const selector = optionValue(argv, '--app') || optionValue(argv, '--app-id')
  const apps = listApps()
  if (!selector) return apps
  const selected = apps.find((app) => app.manifest.id === selector || app.directoryName === selector)
  if (!selected) throw new Error(`Unknown App: ${selector}`)
  return [selected]
}

export async function listFiles(root, options = {}) {
  const excluded = new Set(options.excluded || [])
  const output = []
  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      if (excluded.has(relativePath)) continue
      const stat = await fsp.lstat(absolutePath)
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${relativePath}`)
      if (stat.isDirectory()) await visit(absolutePath)
      else if (stat.isFile()) output.push({ absolutePath, relativePath, size: stat.size })
      else throw new Error(`Unsupported package entry: ${relativePath}`)
    }
  }
  await visit(root)
  return output
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256Integrity(value) {
  return `sha256-${createHash('sha256').update(value).digest('base64')}`
}

export function canonicalChecksums(checksums) {
  return Object.fromEntries(Object.entries(checksums).sort(([left], [right]) => left.localeCompare(right)))
}

export function signaturePayload(manifest, checksums, metadata) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    appId: manifest.id,
    version: manifest.version,
    publisherId: metadata.publisherId,
    keyId: metadata.keyId,
    checksums: canonicalChecksums(checksums),
  }), 'utf8')
}

export function releaseNotesForVersion(appRoot, version) {
  const changelogPath = path.join(appRoot, 'CHANGELOG.md')
  if (!fs.existsSync(changelogPath)) return ''
  const content = fs.readFileSync(changelogPath, 'utf8')
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(`^##\\s+(?:\\[)?${escaped}(?:\\])?[^\\r\\n]*(?:\\r?\\n|$)`, 'm')
  const match = heading.exec(content)
  if (!match) return ''
  const remaining = content.slice(match.index + match[0].length)
  const nextHeading = remaining.search(/^##\s+/m)
  return remaining.slice(0, nextHeading < 0 ? undefined : nextHeading).trim()
}
