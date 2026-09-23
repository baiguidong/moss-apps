export async function fetchGitHubReleaseRecords(repository, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  const records = []
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'moss-apps-catalog-builder/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, { headers })
    if (!response.ok) throw new Error(`Unable to list GitHub releases: HTTP ${response.status}`)
    const releases = await response.json()
    for (const release of releases) {
      if (release.draft) continue
      let assets = release.assets || []
      // Newly published releases can omit assets in the embedded release listing.
      if (!assets.some((asset) => asset.name.endsWith('.release.json'))) {
        assets = []
        for (let assetPage = 1; ; assetPage += 1) {
          const assetResponse = await fetchImpl(`https://api.github.com/repos/${repository}/releases/${release.id}/assets?per_page=100&page=${assetPage}`, { headers })
          if (!assetResponse.ok) throw new Error(`Unable to list assets for ${release.tag_name}: HTTP ${assetResponse.status}`)
          const entries = await assetResponse.json()
          assets.push(...entries)
          if (entries.length < 100) break
        }
      }
      for (const asset of assets) {
        if (!asset.name.endsWith('.release.json')) continue
        const assetResponse = await fetchImpl(asset.browser_download_url, { headers })
        if (!assetResponse.ok) throw new Error(`Unable to download ${asset.name}: HTTP ${assetResponse.status}`)
        records.push(await assetResponse.json())
      }
    }
    if (releases.length < 100) break
  }
  return records
}
