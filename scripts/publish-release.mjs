import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import semver from 'semver'
import { repoRoot, selectApps, optionValue, sha256Hex, releaseNotesForVersion } from './lib.mjs'
import { githubClient, tagCommit } from './release-api.mjs'
import { verifySourceArchive } from './verify-source-package.mjs'

// Validate all targets before the first remote mutation. The supplied verifier is
// injectable only for tests; the CLI always validates trusted signatures/source.
export async function collectReleaseAssets(app, root, sourceSha, repository, verifyArchive = verifySourceArchive) {
  const { id, version } = app.manifest, tag = `${id}-v${version}`
  const variants = app.manifest.platforms || [null]
  const files = new Map()
  for (const platform of variants) {
    const stem = `${id}-${version}${platform ? `-${platform}` : ''}`
    const metadataName = `${stem}.release.json`
    const metadataBytes = await fs.readFile(path.join(root, metadataName))
    const record = JSON.parse(metadataBytes)
    const artifact = platform ? record.version?.artifacts?.[platform] : record.version?.artifact
    const expectedPlatforms = platform ? [platform] : app.marketplace.platforms
    if (record.app?.id !== id || record.version?.version !== version || JSON.stringify(record.version.platforms) !== JSON.stringify(expectedPlatforms)) throw new Error('Release identity or platforms mismatch')
    if (!artifact?.signed || artifact.sourceIncluded !== true || artifact.sourceFormat !== 1 || artifact.fileName !== `${stem}.zip`
        || artifact.publisherId !== app.manifest.publisher?.id || record.app.publisher?.id !== artifact.publisherId
        || artifact.downloadUrl !== `https://github.com/${repository}/releases/download/${tag}/${stem}.zip`) throw new Error('Release must describe the signed source archive and correct download URL')
    const zip = await fs.readFile(path.join(root, artifact.fileName))
    if (zip.length !== artifact.size || sha256Hex(zip) !== artifact.sha256) throw new Error('Release archive bytes mismatch')
    const checksum = await fs.readFile(path.join(root, `${stem}.sha256`))
    if (checksum.toString().trim() !== `${artifact.sha256}  ${artifact.fileName}`) throw new Error('SHA-256 asset mismatch')
    const checked = await verifyArchive(path.join(root, artifact.fileName), { requireSignature: true })
    if (checked.appId !== id || checked.version !== version || checked.sourceHash !== artifact.sourceHash
        || checked.publisherId !== artifact.publisherId || checked.keyId !== artifact.keyId
        || checked.origin?.commit !== sourceSha || checked.origin.dirty !== false || checked.sdk?.dirty !== false
        || (platform && JSON.stringify(checked.platforms) !== JSON.stringify([platform]))) throw new Error('Signed source identity, target or commit mismatch')
    files.set(artifact.fileName, zip)
    files.set(`${stem}.sha256`, checksum)
    files.set(metadataName, metadataBytes)
  }
  return files
}

export async function publishRelease(client, { appId, version, sourceSha, files, notes = '' }) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(appId) || !semver.valid(version) || !/^[a-f0-9]{40}$/.test(sourceSha) || !files.size) throw new Error('Invalid publication context')
  const tag = `${appId}-v${version}`
  const marker = `<!-- moss-source:${sourceSha} -->`
  const releases = await client.pages('/releases')
  let release = releases.find(r => r.tag_name === tag)
  if (release && !release.draft) return { status: 'already-published', tag }
  // Recheck ordering in case another workflow published while this build ran.
  const newer = releases.find(r => !r.draft && r.tag_name?.startsWith(`${appId}-v`) && (() => {
    const candidate = r.tag_name.slice(appId.length + 2)
    return semver.valid(candidate) && (semver.prerelease(version) || (!r.prerelease && !semver.prerelease(candidate))) && semver.gte(candidate, version)
  })())
  if (newer) return { status: 'superseded', tag, latest: newer.tag_name }
  if (release && (release.target_commitish !== sourceSha || !release.body?.includes(marker))) throw new Error('Existing draft belongs to another source commit or publisher workflow')
  let commit = await tagCommit(client, tag)
  if (commit && commit !== sourceSha) throw new Error(`Tag ${tag} points to another commit`)
  if (!commit) {
    try {
      await client.request('/git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: sourceSha } })
    } catch (error) {
      // GITHUB_TOKEN cannot tag an older commit whose workflows differ from
      // the default branch. Let the queued push/scheduled batch rebuild the
      // current source; never move the tag or publish bytes from another SHA.
      if (error.status === 403 && !release) {
        const repository = await client.request('')
        const current = await client.request(`/commits/${encodeURIComponent(repository.default_branch)}`)
        if (/^[a-f0-9]{40}$/.test(current.sha) && current.sha !== sourceSha) {
          return { status: 'deferred', reason: 'source-advanced', tag, sourceSha, currentSha: current.sha }
        }
      }
      throw error
    }
  }
  if (!release) release = await client.request('/releases', { method: 'POST', body: {
    tag_name: tag, target_commitish: sourceSha, name: `${appId} v${version}`,
    body: `${notes}\n\n${marker}`, draft: true, prerelease: Boolean(semver.prerelease(version)),
  } })
  const assets = await client.pages(`/releases/${release.id}/assets`)
  for (const asset of assets) if (!files.has(asset.name)) throw new Error(`Unexpected draft asset: ${asset.name}`)
  const verifiedAssets = new Map()
  for (const [name, bytes] of files) {
    const existing = assets.filter(a => a.name === name)
    if (existing.length > 1) throw new Error(`Duplicate draft asset: ${name}`)
    const asset = existing[0] || await client.request(`${release.upload_url.replace(/\{.*$/, '')}?name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes })
    const remote = await client.request(`/releases/assets/${asset.id}`, { bytes: true })
    if (remote.length !== bytes.length || sha256Hex(remote) !== sha256Hex(bytes)) throw new Error(`Draft asset differs: ${name}; no assets were overwritten`)
    verifiedAssets.set(name, asset.id)
  }
  // Detect external changes between upload and finalization.
  const current = await client.request(`/releases/${release.id}`)
  if (!current.draft || current.tag_name !== tag || current.target_commitish !== sourceSha || !current.body?.includes(marker)) throw new Error('Release changed during upload')
  if (await tagCommit(client, tag) !== sourceSha) throw new Error('Tag changed during upload')
  const finalAssets = await client.pages(`/releases/${release.id}/assets`)
  if (finalAssets.length !== files.size || finalAssets.some(a => verifiedAssets.get(a.name) !== a.id)) throw new Error('Incomplete release assets')
  await client.request(`/releases/${release.id}`, { method: 'PATCH', body: { draft: false, prerelease: Boolean(semver.prerelease(version)), make_latest: 'false' } })
  return { status: 'published', tag, assets: files.size }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2)
  const appId = optionValue(argv, '--app'), version = optionValue(argv, '--version'), sourceSha = optionValue(argv, '--source-sha')
  if (!appId || !version || !sourceSha) throw new Error('--app, --version and --source-sha are required')
  const app = selectApps(['--app', appId])[0]
  if (app.manifest.version !== version) throw new Error('Repository version differs from plan')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  if (head !== sourceSha) throw new Error('Repository commit differs from plan')
  const repository = optionValue(argv, '--repository') || process.env.GITHUB_REPOSITORY
  const client = githubClient(repository)
  const files = await collectReleaseAssets(app, path.join(repoRoot, 'artifacts', appId, version), sourceSha, repository)
  const result = await publishRelease(client, { appId, version, sourceSha, files, notes: releaseNotesForVersion(app.root, version) })
  console.log(JSON.stringify(result))
  if (result.status === 'deferred' && process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${result.tag}: source advanced during the build; GitHub refused the old tag. The queued push or next scheduled batch will rebuild the current commit. No release was published.\n`)
  }
}
