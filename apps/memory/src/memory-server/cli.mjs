import { mkdir, open } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import lockfile from 'proper-lockfile'

const memoryFile = process.argv[2]
if (!memoryFile || !isAbsolute(memoryFile)) throw new Error('Memory requires an absolute App data path.')
process.umask(0o077)
await mkdir(dirname(memoryFile), { recursive: true, mode: 0o700 })
// Opening in append mode checks access without truncating existing memory.
await (await open(memoryFile, 'a+', 0o600)).close()
process.env.MEMORY_FILE_PATH = memoryFile
const { KnowledgeGraphManager } = await import('@modelcontextprotocol/server-memory/dist/index.js')

// Each conversation may own a separate MCP process. Serialize read/modify/write
// operations across those processes; the upstream manager only does atomic rename.
const mutations = ['createEntities', 'createRelations', 'addObservations', 'deleteEntities', 'deleteObservations', 'deleteRelations']
let queue = Promise.resolve()
for (const method of mutations) {
  const original = KnowledgeGraphManager.prototype[method]
  KnowledgeGraphManager.prototype[method] = function (...args) {
    const operation = queue.then(async () => {
      const release = await lockfile.lock(memoryFile, {
        realpath: false, stale: 30_000, update: 5_000,
        retries: { retries: 100, factor: 1, minTimeout: 100, maxTimeout: 100 },
      })
      try { return await original.apply(this, args) }
      finally { await release() }
    })
    queue = operation.catch(() => {})
    return operation
  }
}
