import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { selectApps, repoRoot, readJson } from './lib.mjs'
const tag = String(process.argv[2] || '').trim()
const match = tag.match(/^(.+)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/)
if (!match || !semver.valid(match[2])) throw new Error(`Invalid release tag: ${tag}`)
const [, appId, version] = match
const app = selectApps(['--app', appId])[0]
if (app.manifest.version !== version) throw new Error(`Tag ${tag} does not match repository version ${app.manifest.version}`)
const runners = {
  'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel', 'win32-x64': 'windows-latest',
  'win32-arm64': 'windows-11-arm', 'linux-x64': 'ubuntu-24.04', 'linux-arm64': 'ubuntu-24.04-arm',
}
const platforms = app.manifest.platforms || app.marketplace.platforms
const values = {
  app_id: appId, version, tag, kind: app.kind,
  package_name: app.kind === 'mcp' ? '@moss/app-runtime' : readJson(path.join(app.root, 'package.json')).name,
  app_dir: path.relative(repoRoot, app.root).split(path.sep).join('/'),
  variants: Boolean(app.manifest.platforms),
  platforms: JSON.stringify({ include: platforms.map(platform => {
    if (!runners[platform]) throw new Error(`No CI runner for ${platform}`)
    return { platform, os: runners[platform] }
  }) }),
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
console.log(JSON.stringify(values))
