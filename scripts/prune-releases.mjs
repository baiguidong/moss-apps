import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'
import { githubClient } from './release-api.mjs'
import { listApps, optionValue } from './lib.mjs'

function parseAppTag(tag) {
  if (typeof tag !== 'string') return null
  let parsed
  for (const { index } of tag.matchAll(/-v/g)) {
    const appId = tag.slice(0, index)
    const version = semver.parse(tag.slice(index + 2))
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(appId) || !version) continue
    // A SemVer suffix can contain another `-v`. Keep ambiguous tags intact.
    if (parsed) return null
    parsed = { appId, version }
  }
  return parsed
}

export async function pruneReleases(client, { appId: onlyApp, releases } = {}) {
  const listed = releases ?? await client.pages('/releases')
  const byApp = new Map()
  for (const release of listed) {
    if (release.draft || !release.id) continue
    const parsed = parseAppTag(release.tag_name)
    if (!parsed || (onlyApp && parsed.appId !== onlyApp)) continue
    const { appId, version } = parsed
    const entries = byApp.get(appId) || []
    entries.push({
      release, version, stable: !release.prerelease && version.prerelease.length === 0,
    })
    byApp.set(appId, entries)
  }
  const removed = []
  for (const [appId, entries] of byApp) {
    entries.sort((left, right) => semver.rcompare(left.version, right.version)
      || Number(right.stable) - Number(left.stable)
      || (right.release.published_at || '').localeCompare(left.release.published_at || ''))
    const latest = entries[0]
    // The marketplace still needs a stable release when a prerelease is newer.
    const stable = entries.find(entry => entry.stable)
    for (const entry of entries) {
      if (entry === latest || entry === stable) continue
      const { release } = entry
      await client.request(`/releases/${release.id}`, { method: 'DELETE' })
      removed.push({ appId, tag: release.tag_name, id: release.id })
    }
  }
  return removed
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repository = optionValue(process.argv.slice(2), '--repository') || process.env.GITHUB_REPOSITORY
  const errors = []
  listApps({ onError: error => errors.push(error) })
  if (errors.length) throw new Error(`Cannot prune releases while App definitions are invalid: ${errors.map(error => error.error).join('; ')}`)
  const removed = await pruneReleases(githubClient(repository))
  const summary = `Pruned ${removed.length} superseded App Release${removed.length === 1 ? '' : 's'}. The latest stable Release, any newer published prerelease, and drafts are preserved.`
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Release retention\n\n${summary}\n`)
  console.log(JSON.stringify({ removed: removed.length, releases: removed }))
}
