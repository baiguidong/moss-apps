import { describe, expect, it } from 'bun:test'
import { fetchGitHubReleaseRecords } from './github-releases.mjs'

const repository = 'example/apps'
const releasesUrl = `https://api.github.com/repos/${repository}/releases?per_page=100&page=1`
const assetsUrl = `https://api.github.com/repos/${repository}/releases/42/assets?per_page=100&page=1`
const asset = { name: 'example.app-1.0.0.release.json', browser_download_url: 'https://example.com/release.json' }
const record = { schemaVersion: 1, app: { id: 'example.app' }, version: { version: '1.0.0' } }

function fixture(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    if (!(url in routes)) throw new Error(`Unexpected request: ${url}`)
    const value = routes[url]
    return value instanceof Response ? value : Response.json(value)
  }
  return { calls, fetchImpl }
}

describe('GitHub release metadata discovery', () => {
  it('includes a published version when the release listing omits its assets', async () => {
    const { calls, fetchImpl } = fixture({
      [releasesUrl]: [{ id: 42, tag_name: 'example.app-v1.0.0', assets: [] }],
      [assetsUrl]: [asset],
      [asset.browser_download_url]: record,
    })
    expect(await fetchGitHubReleaseRecords(repository, { fetchImpl })).toEqual([record])
    expect(calls).toContain(assetsUrl)
  })

  it('uses metadata already present in the release listing', async () => {
    const { calls, fetchImpl } = fixture({
      [releasesUrl]: [{ id: 42, assets: [asset] }],
      [asset.browser_download_url]: record,
    })
    expect(await fetchGitHubReleaseRecords(repository, { fetchImpl })).toEqual([record])
    expect(calls).not.toContain(assetsUrl)
  })

  it('paginates fallback assets when metadata is on a later page', async () => {
    const { fetchImpl } = fixture({
      [releasesUrl]: [{ id: 42, assets: [{ name: 'package.zip' }] }],
      [assetsUrl]: Array.from({ length: 100 }, (_, index) => ({ name: `asset-${index}.zip` })),
      [assetsUrl.replace('&page=1', '&page=2')]: [asset],
      [asset.browser_download_url]: record,
    })
    expect(await fetchGitHubReleaseRecords(repository, { fetchImpl })).toEqual([record])
  })

  it('fails on asset lookup errors instead of silently dropping a release', async () => {
    const { fetchImpl } = fixture({
      [releasesUrl]: [{ id: 42, tag_name: 'example.app-v1.0.0', assets: [] }],
      [assetsUrl]: new Response('Unavailable', { status: 503 }),
    })
    await expect(fetchGitHubReleaseRecords(repository, { fetchImpl })).rejects.toThrow('Unable to list assets for example.app-v1.0.0: HTTP 503')
  })

  it('does not publish draft release metadata', async () => {
    const { fetchImpl } = fixture({ [releasesUrl]: [{ id: 42, draft: true, assets: [asset] }] })
    expect(await fetchGitHubReleaseRecords(repository, { fetchImpl })).toEqual([])
  })
})
