import fs from 'node:fs/promises'
import path from 'node:path'
import { run, TaskStore } from '@moss/engine-apps/runtime'

export async function trashCandidate(file, roots) {
  if (!path.isAbsolute(file) || file !== path.normalize(file)) return null
  const target = path.join(await fs.realpath(path.dirname(file)), path.basename(file))
  if (target !== file || !roots.some(root => {
    const relative = path.relative(root, target)
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  })) return null
  const stat = await fs.lstat(target, { bigint: true })
  if (!(stat.isFile() || stat.isDirectory() || stat.isSymbolicLink())) return null
  return {
    identity: [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'),
    directory: stat.isDirectory(),
    size: Number(stat.size),
    modified: Number(stat.mtimeNs / 1_000_000_000n),
  }
}

export function selectedMatches(scan, paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 500) throw new Error('请选择 1–500 个匹配项')
  if (scan.status !== 'succeeded' || !scan.result?.trashSelection || scan.input?.followUp) {
    throw new Error('请重新扫描后再勾选要清理的文件')
  }
  const files = new Map(scan.result.groups.flatMap(group => group.files.map(file => [file.path, file])))
  return [...new Set(paths)].map(file => {
    const match = files.get(file)
    if (!match?.trashIdentity) throw new Error(`文件不在可清理的扫描结果中：${file}`)
    return match
  })
}

async function systemTrash(file, signal) {
  const binary = process.platform === 'darwin' ? '/usr/bin/trash' : '/usr/bin/gio'
  await fs.access(binary).catch(() => { throw new Error('当前系统缺少废纸篓命令，请在系统文件管理器中处理') })
  const args = process.platform === 'darwin' ? [file] : ['trash', '--', file]
  await run(binary, args, { signal })
}

async function directoryIsEmptyTree(root, signal) {
  const pending = [root]
  while (pending.length) {
    signal.throwIfAborted()
    const directory = pending.pop()
    if (await fs.realpath(directory) !== directory) return false
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) return false
      pending.push(path.join(directory, entry.name))
    }
  }
  return true
}

export async function trashResult(input, context) {
  if (input.confirmChanges !== true) throw new Error('请先确认要移入废纸篓的文件')
  const scan = await new TaskStore(context.dataDir).get(input.followUp.id)
  const selected = selectedMatches(scan, input.followUp.paths)
  const roots = scan.readRoots || []
  const entries = [], total = selected.length
  const result = { trash: { total, moved: 0, entries } }
  const report = path.join(context.directory, '处理记录.json')
  await context.progress(`正在移入废纸篓 · 0% · 0/${total} 项`)
  try {
    for (const [index, match] of selected.entries()) {
      context.signal.throwIfAborted()
      try {
        const current = await trashCandidate(match.path, roots)
        if (!current || current.identity !== match.trashIdentity) throw new Error('文件已变化，请重新扫描')
        if (current.directory && !(await directoryIsEmptyTree(match.path, context.signal))) throw new Error('目录内仍有文件，请逐项检查')
        await systemTrash(match.path, context.signal)
        result.trash.moved++
        entries.push({ path: match.path, status: 'moved' })
      } catch (error) {
        context.signal.throwIfAborted()
        const message = error.code === 'ENOENT' ? '文件已不存在' : error.message
        entries.push({ path: match.path, status: 'skipped', message: message.slice(0, 600) })
      }
      const done = index + 1
      if (done % 10 === 0 || done === total) await context.progress(`正在移入废纸篓 · ${Math.round(done / total * 100)}% · ${done}/${total} 项`)
    }
  } finally {
    await fs.writeFile(report, JSON.stringify(result.trash, null, 2))
    await context.record({ result, artifacts: [{ name: '处理记录.json', path: report, kind: 'json' }] })
  }
  const { moved } = result.trash
  return {
    status: moved === total ? 'succeeded' : moved ? 'partial' : 'failed',
    message: `已移入废纸篓 ${moved} 项，未处理 ${total - moved} 项`,
  }
}
