const platforms = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'])
const stable = value => JSON.stringify(value, Object.keys(value).sort())
function variants(version) {
  if (!Array.isArray(version.platforms) || !version.platforms.length || new Set(version.platforms).size !== version.platforms.length || version.platforms.some(p => !platforms.has(p))) throw new Error('Invalid release platforms')
  if (version.artifacts !== undefined) {
    if (version.artifact || !version.artifacts || Array.isArray(version.artifacts) || typeof version.artifacts !== 'object') throw new Error('Use either artifact or artifacts')
    const keys = Object.keys(version.artifacts)
    if (keys.length !== version.platforms.length || keys.some(p => !version.platforms.includes(p))) throw new Error('Artifact platforms must exactly match version platforms')
    return version.artifacts
  }
  if (!version.artifact) throw new Error('Missing release artifact')
  return Object.fromEntries(version.platforms.map(p => [p, version.artifact]))
}

export function mergeReleaseVersions(previous, next) {
  const incoming = variants(next)
  if (!previous) return next
  if (previous.version !== next.version || previous.hostApi !== next.hostApi || JSON.stringify([...(previous.permissions || [])].sort()) !== JSON.stringify([...(next.permissions || [])].sort())) throw new Error('Conflicting release version metadata')
  const offlineKits = { ...previous.offlineKits }
  for (const [platform, kit] of Object.entries(next.offlineKits || {})) {
    if (offlineKits[platform] && stable(offlineKits[platform]) !== stable(kit)) throw new Error(`Conflicting offline kit: ${next.version} ${platform}`)
    offlineKits[platform] = kit
  }
  const kits = Object.keys(offlineKits).length ? { offlineKits } : {}
  const artifacts = { ...variants(previous) }
  for (const [platform, artifact] of Object.entries(incoming)) {
    if (artifacts[platform] && stable(artifacts[platform]) !== stable(artifact)) throw new Error(`Conflicting immutable artifact: ${next.version} ${platform}`)
    artifacts[platform] = artifact
  }
  if (previous.artifact && next.artifact && stable(previous.artifact) === stable(next.artifact)) return { ...previous, ...kits, platforms: Object.keys(artifacts).sort() }
  const { artifact: ignored, ...base } = previous
  return { ...base, ...kits, platforms: Object.keys(artifacts).sort(), artifacts }
}
