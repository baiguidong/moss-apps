import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import semver from 'semver'
import { listApps, optionValue, repoRoot, writeJson } from './lib.mjs'
import { githubClient } from './release-api.mjs'

export function planReleases(apps, releases, sourceSha, errors = []) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('A full source commit SHA is required')
  const entries = apps.map(app => {
    const { id, version } = app.manifest
    const tag = `${id}-v${version}`
    const matching = releases.filter(r => r.tag_name?.startsWith(`${id}-v`))
    const same = matching.find(r => r.tag_name === tag && !r.draft)
    const stable = !semver.prerelease(version)
    const published = matching.filter(r => !r.draft).map(r => ({ release: r, version: r.tag_name.slice(id.length + 2) }))
      .filter(r => semver.valid(r.version) && (!stable || (!semver.prerelease(r.version) && !r.release.prerelease)))
      .sort((a, b) => semver.rcompare(a.version, b.version))
    const latest = published[0]?.version
    let action = 'publish', reason = 'new-app'
    if (same) { action = 'skip'; reason = 'already-published' }
    else if (latest && semver.lt(version, latest)) { action = 'skip'; reason = 'repository-behind' }
    else if (latest && semver.eq(version, latest)) { action = 'skip'; reason = 'same-version-precedence' }
    else if (matching.some(r => r.tag_name === tag && r.draft)) reason = 'resume-draft'
    else if (latest) reason = 'new-version'
    return { app_id: id, version, tag, kind: app.kind, source_sha: sourceSha, action, reason, latest: latest || null,
      ...(same && !same.assets?.some(a => a.name.endsWith('.release.json')) ? { warning: 'Published release has no embedded metadata; inspect it without overwriting this version.' } : {}) }
  })
  return { schemaVersion: 1, sourceSha, entries, errors, candidates: entries.filter(e => e.action === 'publish') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2), errors = []
  const apps = listApps({ onError: error => errors.push(error) })
  const repository = optionValue(argv, '--repository') || process.env.GITHUB_REPOSITORY || 'baiguidong/moss-apps'
  const file = optionValue(argv, '--releases-file')
  const releases = file ? JSON.parse(await fs.readFile(file, 'utf8')) : await githubClient(repository).pages('/releases')
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const plan = planReleases(apps, releases, sourceSha, errors)
  plan.sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim())
  await writeJson(path.resolve(optionValue(argv, '--output') || 'release-plan.json'), plan)
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({ include: plan.candidates })}\nhas_changes=${plan.candidates.length > 0}\nhas_errors=${errors.length > 0}\nsource_sha=${sourceSha}\n`)
  const summary = ['## App release plan', '', '| App | Version | Action | Reason |', '| --- | --- | --- | --- |',
    ...plan.entries.map(e => `| ${e.app_id} | ${e.version} | ${e.action} | ${e.reason} |`), '',
    ...(plan.sourceDirty ? ['- Local source is uncommitted; commit it and pin Core before signed publication.'] : []),
    ...errors.map(e => `- Invalid source: ${e.path}: ${e.error}`)].join('\n')
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
  console.log(summary)
}
