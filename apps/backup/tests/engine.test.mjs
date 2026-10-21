import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { hash, run } from '@moss/engine-apps/runtime'
import { buildArgs, runBackupCommand } from '../src/backend/engine.mjs'

test('backup args preserve source paths and never contain a password', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-restic-'))
  try {
    const repo = path.join(root, 'repo'), source = path.join(root, "中文 '[]$;&")
    await fs.mkdir(repo); await fs.mkdir(source)
    const result = await buildArgs({ command: 'backup', repo, paths: [source] })
    assert.deepEqual(result.args, ['-r', await fs.realpath(repo), 'backup', '--json', await fs.realpath(source)])
    await assert.rejects(buildArgs({ command: 'restore', repo, snapshot: '../bad', target: source }), /快照/)
    await assert.rejects(buildArgs({ command: 'raw', args: ['prune'] }), /确认/)
    assert.deepEqual((await buildArgs({ command: 'raw', args: ['-r', repo, 'prune'], confirmChanges: true })).args, ['-r', repo, 'prune'])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('large backup stdout is complete on disk while summary, errors and exit code stay available', { timeout: 30_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-restic-stream-'))
  try {
    const status = JSON.stringify({ message_type: 'status', percent_done: 0.5, files_done: 12 }) + '\n'
    const filler = JSON.stringify({ message_type: 'verbose_status', item: 'x'.repeat(1024) }) + '\n'
    const issue = { message_type: 'error', error: 'fixture 文件无法读取' }
    const error = JSON.stringify(issue) + '\n'
    const ignored = 'null\n'
    const summary = { message_type: 'summary', total_files_processed: 18_000, data_added_packed: 123 }
    const final = JSON.stringify(summary) + '\n'
    const count = Math.ceil((17 * 1024 * 1024) / Buffer.byteLength(filler))
    const script = `
const status = ${JSON.stringify(status)}, filler = ${JSON.stringify(filler)}
const ignored = ${JSON.stringify(ignored)}, error = ${JSON.stringify(error)}, summary = ${JSON.stringify(final)}
let remaining = ${count}
process.stdout.write(status)
function pump() {
  while (remaining > 0) {
    remaining--
    if (!process.stdout.write(filler)) return process.stdout.once('drain', pump)
  }
  process.stdout.write(ignored)
  process.stdout.write(error)
  process.stdout.write(summary)
  process.exitCode = 3
}
pump()
`
    const progress = []
    const result = await runBackupCommand(process.execPath, ['-e', script], {
      directory, progress: message => { progress.push(message) }, log: () => {},
    })
    const expectedBytes = Buffer.byteLength(status) + count * Buffer.byteLength(filler)
      + Buffer.byteLength(ignored) + Buffer.byteLength(error) + Buffer.byteLength(final)
    assert(expectedBytes > 16 * 1024 * 1024)
    const expectedHash = createHash('sha256').update(status)
    for (let i = 0; i < count; i++) expectedHash.update(filler)
    expectedHash.update(ignored).update(error).update(final)
    assert.equal(result.code, 3)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.summary, summary)
    assert.deepEqual(result.messages, [issue])
    assert(progress.some(message => message.includes('50% · 12 个文件')))
    assert.equal((await fs.stat(result.reportPath)).size, expectedBytes)
    assert.equal(await hash(result.reportPath), expectedHash.digest('hex'))
    await assert.rejects(run(process.execPath, ['-e', script]), /输出超过 16 MiB/)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('canceling a streamed backup stops its child and closes the partial report', { timeout: 15_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-restic-cancel-'))
  const controller = new AbortController(), pidFile = path.join(directory, 'child.pid')
  const status = JSON.stringify({ message_type: 'status', percent_done: 0.1, files_done: 1 }) + '\n'
  let ready
  const started = new Promise(resolve => { ready = resolve })
  const script = `
require('node:fs').writeFileSync(process.argv[1], String(process.pid))
process.stdout.write(${JSON.stringify(status)})
setInterval(() => process.stdout.write(${JSON.stringify(status)}), 5)
`
  let operation, timeout
  try {
    operation = runBackupCommand(process.execPath, ['-e', script, pidFile], {
      directory, signal: controller.signal, log: () => {},
      progress: () => { ready?.(); ready = null },
    })
    await Promise.race([
      started,
      operation.then(() => { throw new Error('工作进程过早结束') }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('等待备份输出超时')), 5_000) }),
    ])
    controller.abort(new Error('fixture canceled'))
    await assert.rejects(operation, /fixture canceled/)
    assert((await fs.readFile(path.join(directory, '运行输出.txt'), 'utf8')).includes(status))
    const pid = Number(await fs.readFile(pidFile, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    clearTimeout(timeout)
    controller.abort()
    await operation?.catch(() => {})
    await fs.rm(directory, { recursive: true, force: true })
  }
})
