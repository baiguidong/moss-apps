import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskStore } from '@moss/engine-apps/runtime'
import backupCommands from '../backup-commands.json' with { type: 'json' }
import { isCleanup } from './cleanup.mjs'

const taskId = /^[a-f0-9-]{36}$/
const terminal = new Set(['succeeded', 'failed', 'canceled', 'interrupted', 'partial'])
const reportFiles = new Set([
  'results.json', 'results.txt', 'stderr.log', '运行输出.txt', '错误输出.txt',
  '备份摘要.json', '恢复摘要.json', '处理记录.json', '处理日志.txt',
])

async function stat(file) {
  try { return await fs.lstat(file) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

export async function importLegacyHistory(dataDir, signal) {
  const result = { imported: 0, existing: 0, active: 0, skipped: 0 }
  const owner = path.resolve(dataDir, '../../..')
  const defaultInstance = path.join('moss.file-management', 'instances', 'moss.file-management--default')
  if (path.relative(owner, dataDir) !== defaultInstance) throw new Error('请在文件管理的默认实例导入旧任务')
  const realOwner = await fs.realpath(owner)
  const store = new TaskStore(dataDir)
  const expectedPath = file => path.join(realOwner, path.relative(owner, file))
  await fs.mkdir(store.root, { recursive: true, mode: 0o700 })
  if (await fs.realpath(store.root) !== expectedPath(store.root)) throw new Error('文件管理任务目录包含符号链接')

  for (const appId of ['moss.backup', 'moss.file-cleaner']) {
    const legacy = path.join(owner, appId, 'instances', `${appId}--default`)
    const oldStore = new TaskStore(legacy)
    if (!await stat(oldStore.root)) continue
    if (await fs.realpath(oldStore.root) !== expectedPath(oldStore.root)) throw new Error('旧任务目录包含符号链接')
    for (const entry of await fs.readdir(oldStore.root, { withFileTypes: true })) {
      signal?.throwIfAborted()
      if (!entry.isDirectory() || !taskId.test(entry.name)) continue
      const id = entry.name, source = oldStore.directory(id), destination = store.directory(id)
      if (await stat(destination)) { result.existing++; continue }
      let task
      try {
        if (!(await stat(path.join(source, 'task.json')))?.isFile()) { result.skipped++; continue }
        task = await oldStore.read(id)
      } catch (error) {
        if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error
        result.skipped++; continue
      }
      const supported = isCleanup(task.input) || (appId === 'moss.backup' && backupCommands.includes(task.input?.command))
      if (!supported || !Number.isSafeInteger(task.createdAt) || task.createdAt < 0 || typeof task.message !== 'string'
        || !Array.isArray(task.artifacts) || task.artifacts.some(file => typeof file?.path !== 'string')) {
        result.skipped++; continue
      }
      if (!terminal.has(task.status)) { result.active++; continue }

      const stage = await fs.mkdtemp(path.join(store.root, '.import-'))
      try {
        for (const name of reportFiles) {
          signal?.throwIfAborted()
          const file = path.join(source, name)
          if ((await stat(file))?.isFile()) await fs.copyFile(file, path.join(stage, name))
        }
        const artifacts = task.artifacts.map(({ url, ...file }, index) => {
          const name = path.basename(file.path)
          const original = path.dirname(file.path)
          if (reportFiles.has(name) && (original === source || original === expectedPath(source))) {
            return { ...file, path: path.join(destination, name) }
          }
          // Source images remain read-only previews whose paths are checked against readRoots by the runtime.
          if (file.kind === 'image' && path.isAbsolute(file.path)) return file
          return { ...file, path: path.join(destination, `unavailable-${index}`) }
        })
        const { pid, ...record } = task
        await fs.writeFile(path.join(stage, 'task.json'), JSON.stringify({ ...record, artifacts }), { mode: 0o600 })
        signal?.throwIfAborted()
        try { await fs.rename(stage, destination); result.imported++ }
        catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; result.existing++ }
      } finally { await fs.rm(stage, { recursive: true, force: true }) }
    }
  }
  return result
}
