import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Product notes only. Paths, versions, grants and receipts always come from Core.
export function createProjectNotes(directory) {
  const file = path.join(directory, 'project-notes.json')
  let queue = Promise.resolve()
  async function read() {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }
  return {
    async all() { await queue; return read() },
    save(projectRef, notes) {
      const work = async () => {
        const data = await read(), previous = data[projectRef] || {}
        data[projectRef] = { ...previous, ...Object.fromEntries(Object.entries(notes).filter(([key, value]) => ['title', 'requirements', 'analysis'].includes(key) && typeof value === 'string').map(([key, value]) => [key, value.slice(0, key === 'title' ? 160 : 12000)])) }
        await fs.mkdir(directory, { recursive: true })
        const temporary = `${file}.${randomUUID()}.tmp`
        await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 }); await fs.rename(temporary, file)
      }
      const task = queue.then(work, work); queue = task.catch(() => {}); return task
    },
  }
}
