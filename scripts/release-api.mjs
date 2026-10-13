export function githubClient(repository, { token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, fetchImpl = fetch } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Expected owner/repository')
  const base = `https://api.github.com/repos/${repository}`
  async function request(route, { method = 'GET', body, bytes = false, optional = false } = {}) {
    const url = route.startsWith('https://') ? route : `${base}${route}`
    // Only GitHub API/upload endpoints receive the token.
    if (!['api.github.com', 'uploads.github.com'].includes(new URL(url).hostname)) throw new Error('Unexpected GitHub API endpoint')
    const response = await fetchImpl(url, {
      method, signal: AbortSignal.timeout(120000),
      headers: { Accept: bytes ? 'application/octet-stream' : 'application/vnd.github+json',
        'User-Agent': 'moss-apps-release', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' } : {}),
      },
      ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
    })
    if (optional && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${method} ${new URL(url).pathname}: HTTP ${response.status}`)
    if (response.status === 204) return null
    return bytes ? Buffer.from(await response.arrayBuffer()) : response.json()
  }
  async function pages(route) {
    const entries = []
    for (let page = 1; ; page++) {
      const batch = await request(`${route}?per_page=100&page=${page}`)
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub listing')
      entries.push(...batch)
      if (batch.length < 100) return entries
    }
  }
  return { request, pages, repository }
}

export async function tagCommit(client, tag) {
  const ref = await client.request(`/git/ref/tags/${encodeURIComponent(tag)}`, { optional: true })
  if (!ref) return null
  let object = ref.object
  for (let i = 0; object.type === 'tag' && i < 10; i++) object = (await client.request(`/git/tags/${object.sha}`)).object
  if (object.type !== 'commit') throw new Error(`Tag ${tag} does not resolve to a commit`)
  return object.sha
}
