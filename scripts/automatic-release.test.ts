import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { planReleases } from './plan-releases.mjs'
import { githubClient, tagCommit } from './release-api.mjs'
import { publishRelease, collectReleaseAssets } from './publish-release.mjs'
import { sha256Hex } from './lib.mjs'

const sha = 'a'.repeat(40), other = 'b'.repeat(40)
const app = (version = '1.0.0', id = 'moss.example') => ({ kind: 'mcp', manifest: { id, version } })
const release = (version: string, extra = {}) => ({ tag_name: `moss.example-v${version}`, draft: false, ...extra })
const planned = (version: string, releases: any[]) => planReleases([app(version)], releases, sha).entries[0]

test('plans new Apps, greater versions and drafts while preserving published versions', () => {
  expect(planned('1.0.0', []).reason).toBe('new-app')
  expect(planned('1.1.0', [release('1.0.0')]).reason).toBe('new-version')
  expect(planned('1.0.0', [release('1.0.0', { draft: true })]).reason).toBe('resume-draft')
  expect(planned('1.0.0', [release('1.0.0')]).action).toBe('skip')
  expect(planned('1.0.0', [release('2.0.0'), release('0.9.0')]).reason).toBe('repository-behind')
  expect(planned('1.0.0', [release('1.0.0')]).warning).toContain('metadata')
})
test('stable and prerelease channels compare correctly; build metadata cannot republish precedence', () => {
  expect(planned('1.1.0', [release('2.0.0-beta.1', { prerelease: true }), release('1.0.0')]).action).toBe('publish')
  expect(planned('2.0.0-beta.2', [release('2.0.0-beta.1', { prerelease: true })]).action).toBe('publish')
  expect(planned('2.0.0-beta.1', [release('2.0.0')]).action).toBe('skip')
  expect(planned('1.0.0+new', [release('1.0.0+old')]).action).toBe('skip')
})
test('isolates invalid App reports and binds candidates to source commit', () => {
  const errors = [{ appId: 'bad', error: 'invalid' }]
  const plan = planReleases([app(), app('2.0.0', 'moss.regular')], [], sha, errors)
  expect(plan.candidates).toHaveLength(2)
  expect(plan.candidates.every(e => e.source_sha === sha)).toBe(true)
  expect(plan.errors).toEqual(errors)
  expect(() => planReleases([], [], 'main')).toThrow('full source commit')
})
test('GitHub scan paginates and API failures fail closed', async () => {
  const calls: string[] = []
  const client = githubClient('test/apps', { token: '', fetchImpl: async url => {
    calls.push(url)
    return Response.json(url.endsWith('page=1') ? Array.from({ length: 100 }, () => release('1.0.0')) : [release('2.0.0')])
  } })
  expect(await client.pages('/releases')).toHaveLength(101)
  expect(calls).toHaveLength(2)
  const failing = githubClient('test/apps', { token: '', fetchImpl: async () => new Response('', { status: 503 }) })
  await expect(failing.pages('/releases')).rejects.toThrow('HTTP 503')
  await expect(failing.request('https://example.com')).rejects.toThrow('Unexpected')
})

function fake() {
  const state: any = { releases: [], assets: [], data: new Map(), tag: null, uploads: 0, failAt: 0, events: [] }
  const client = {
    async pages(route: string) { return route === '/releases' ? state.releases : state.assets },
    async request(route: string, options: any = {}) {
      const { method = 'GET', body } = options
      state.events.push(`${method} ${route}`)
      if (route.startsWith('/git/ref/')) return state.tag ? { object: { type: 'commit', sha: state.tag } } : null
      if (route === '/git/refs') { state.tag = body.sha; return {} }
      if (route === '/releases' && method === 'POST') {
        const r = { ...body, id: 1, upload_url: 'https://uploads.github.com/repos/test/apps/releases/1/assets{?name,label}' }
        state.releases.push(r); return r
      }
      if (route.startsWith('https://uploads.')) {
        state.uploads++
        if (state.failAt === state.uploads) throw new Error('upload interrupted')
        const name = new URL(route).searchParams.get('name'), id = state.assets.length + 1
        state.assets.push({ id, name }); state.data.set(id, body); return { id, name }
      }
      if (route.startsWith('/releases/assets/')) return state.data.get(Number(route.split('/').pop()))
      if (route === '/releases/1') {
        if (method === 'PATCH') Object.assign(state.releases[0], body)
        return state.releases[0]
      }
      throw new Error(`Unexpected fake request: ${route}`)
    },
  }
  return { client, state }
}
const request = () => ({ appId: 'moss.example', version: '1.0.0', sourceSha: sha,
  files: new Map([['one.zip', Buffer.from('zip')], ['one.sha256', Buffer.from('checksum')], ['one.release.json', Buffer.from('metadata')]]) })

test('publishes only after all assets are verified; formal release reruns never mutate', async () => {
  const { client, state } = fake()
  expect((await publishRelease(client, request())).status).toBe('published')
  expect(state.events.at(-1)).toBe('PATCH /releases/1')
  expect(state.assets).toHaveLength(3)
  const mutations = state.events.length
  expect((await publishRelease(client, request())).status).toBe('already-published')
  expect(state.events).toHaveLength(mutations)
})
test('interrupted upload resumes missing assets and never publishes an incomplete draft', async () => {
  const { client, state } = fake(); state.failAt = 2
  await expect(publishRelease(client, request())).rejects.toThrow('interrupted')
  expect(state.releases[0].draft).toBe(true)
  expect(state.assets).toHaveLength(1)
  expect((await publishRelease(client, request())).status).toBe('published')
  expect(state.uploads).toBe(4)
})
test('rejects conflicting draft bytes without replacing them', async () => {
  const { client, state } = fake(); state.failAt = 2
  await expect(publishRelease(client, request())).rejects.toThrow()
  state.data.set(1, Buffer.from('different'))
  await expect(publishRelease(client, request())).rejects.toThrow('Draft asset differs')
  expect(state.assets).toHaveLength(1)
  expect(state.releases[0].draft).toBe(true)
})
test('rejects foreign drafts and tags; does not publish over a newer release', async () => {
  const a = fake(); a.state.tag = other
  await expect(publishRelease(a.client, request())).rejects.toThrow('another commit')
  expect(a.state.releases).toHaveLength(0)
  const b = fake(); b.state.failAt = 1
  await expect(publishRelease(b.client, request())).rejects.toThrow('interrupted')
  b.state.releases[0].target_commitish = other
  await expect(publishRelease(b.client, request())).rejects.toThrow('another source commit')
  const c = fake(); c.state.releases.push(release('2.0.0'))
  expect((await publishRelease(c.client, request())).status).toBe('superseded')
  expect(c.state.events).toHaveLength(0)
})
test('annotated tags resolve to commits', async () => {
  const client = { request: async route => route.startsWith('/git/ref') ? { object: { type: 'tag', sha: other } } : { object: { type: 'commit', sha } } }
  expect(await tagCommit(client, 'example')).toBe(sha)
})
test('release asset validation rejects incomplete targets, changed bytes and wrong source commits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-assets-'))
  const recordApp = { manifest: { id: 'moss.example', version: '1.0.0', publisher: { id: 'moss' } }, marketplace: { platforms: ['darwin-arm64'] } }
  const zip = Buffer.from('test-archive'), stem = 'moss.example-1.0.0'
  const record = { app: recordApp.manifest, version: { version: '1.0.0', platforms: ['darwin-arm64'], artifact: {
    signed: true, sourceIncluded: true, sourceFormat: 1, sourceHash: 'source-hash', publisherId: 'moss', keyId: 'release-1', fileName: `${stem}.zip`,
    downloadUrl: `https://github.com/test/apps/releases/download/moss.example-v1.0.0/${stem}.zip`, sha256: sha256Hex(zip), size: zip.length,
  } } }
  const verified = { appId: 'moss.example', version: '1.0.0', sourceHash: 'source-hash', publisherId: 'moss', keyId: 'release-1', origin: { commit: sha, dirty: false }, sdk: { dirty: false } }
  try {
    await fs.writeFile(path.join(root, `${stem}.release.json`), JSON.stringify(record))
    await fs.writeFile(path.join(root, `${stem}.zip`), zip)
    await expect(collectReleaseAssets(recordApp, root, sha, 'test/apps', async () => verified)).rejects.toThrow('ENOENT')
    await fs.writeFile(path.join(root, `${stem}.sha256`), `${sha256Hex(zip)}  ${stem}.zip\n`)
    expect((await collectReleaseAssets(recordApp, root, sha, 'test/apps', async () => verified)).size).toBe(3)
    await expect(collectReleaseAssets(recordApp, root, other, 'test/apps', async () => verified)).rejects.toThrow('commit mismatch')
    await fs.writeFile(path.join(root, `${stem}.zip`), 'corrupted')
    await expect(collectReleaseAssets(recordApp, root, sha, 'test/apps', async () => verified)).rejects.toThrow('bytes mismatch')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
