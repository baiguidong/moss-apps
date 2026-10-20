import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const fileName = id => `session-${createHash('sha256').update(id).digest('hex')}.json`
const indexPath = dataDir => path.join(dataDir, 'session-source', 'revisions.json')

export async function loadSessionCache(dataDir) {
  const sessions = new Map()
  const revisions = new Map()
  let index
  try { index = JSON.parse(await fs.readFile(indexPath(dataDir), 'utf8')) } catch { return { sessions, revisions } }
  if (index?.schemaVersion !== 1 || !index.revisions || typeof index.revisions !== 'object'
    || Array.isArray(index.revisions)) return { sessions, revisions }
  for (const [id, revision] of Object.entries(index.revisions)) {
    if (!id || typeof revision !== 'string' || !revision) continue
    try {
      const snapshot = JSON.parse(await fs.readFile(path.join(dataDir, 'session-source', fileName(id)), 'utf8'))
      if (snapshot?.id !== id) continue
      sessions.set(id, snapshot)
      revisions.set(id, revision)
    } catch {}
  }
  return { sessions, revisions }
}

export async function saveSessionCache(dataDir, revisions) {
  const file = indexPath(dataDir)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, revisions: Object.fromEntries(revisions) }),
      { mode: 0o600, flag: 'wx' })
    await fs.rename(temporary, file)
  } finally { await fs.rm(temporary, { force: true }) }
}
