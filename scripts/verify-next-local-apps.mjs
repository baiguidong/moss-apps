import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { TaskStore, WORKER_READY_MESSAGE, WORKER_START_MESSAGE } from '../packages/engine-apps/src/runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-next-apps-'))
const checks = []
const app = name => path.join(root, 'apps', name, 'dist', 'backend')
const cli = async (name, dataDir, input) => {
  const request = path.join(temp, 'request-' + randomUUID() + '.json')
  await fs.writeFile(request, JSON.stringify(input))
  return JSON.parse(execFileSync(process.execPath, [path.join(app(name), 'cli.mjs'), '--data-dir', dataDir, 'run', '--input-file', request], { encoding: 'utf8', timeout: 120000 }))
}
const worker = async (dataDir, input) => {
  const store = new TaskStore(dataDir), task = await store.create(input)
  const child = spawn(process.execPath, [path.join(app('backup'), 'worker.mjs'), dataDir, task.id], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, RESTIC_PASSWORD: 'moss-verification-password' },
  })
  let stderr = '', started = false
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Backup worker timed out: ' + stderr)) }, 120000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.on('message', message => {
      if (started || message?.type !== WORKER_READY_MESSAGE) return
      started = true
      child.send({ type: WORKER_START_MESSAGE }, error => { if (error) { child.kill('SIGKILL'); reject(error) } })
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Backup worker exited ${code ?? signal}: ${stderr}`))
    })
  })
  return store.get(task.id)
}
try {
  const dataDir = path.join(temp, 'duckdb-data'), file = path.join(temp, "中文 '[]$;&.csv")
  await fs.mkdir(dataDir); await fs.writeFile(file, 'id,name\n1,甲\n2,乙\n')
  const preview = await cli('data-workbench', dataDir, { mode: 'preview', path: file })
  assert.equal(preview.status, 'succeeded', preview.message)
  assert.deepEqual(preview.result.rows.map(row => row.name), ['甲', '乙'])
  const exportTask = await cli('data-workbench', dataDir, { mode: 'export', sql: "SELECT * FROM read_csv_auto('" + file.replaceAll("'", "''") + "')", format: 'parquet', outputName: 'result.parquet' })
  assert.equal(exportTask.status, 'succeeded', exportTask.message)
  assert((await fs.stat(exportTask.artifacts[0].path)).size > 0)
  checks.push('DuckDB preview and Parquet export read real rows')

  const backupDir = path.join(temp, 'backup-data'), repository = path.join(temp, 'repository'), source = path.join(temp, 'source'), restore = path.join(temp, 'restore')
  await Promise.all([backupDir, repository, source, restore].map(dir => fs.mkdir(dir)))
  await fs.writeFile(path.join(source, 'note.txt'), 'restic real restore\n')
  assert.equal((await worker(backupDir, { command: 'init', repo: repository })).status, 'succeeded')
  const saved = await worker(backupDir, { command: 'backup', repo: repository, paths: [source] })
  assert.equal(saved.status, 'succeeded', saved.message)
  assert.equal(saved.result.summary.total_files_processed, 1)
  const snapshots = await worker(backupDir, { command: 'snapshots', repo: repository })
  assert.equal(snapshots.result.snapshots.length, 1)
  const restored = await worker(backupDir, { command: 'restore', repo: repository, snapshot: snapshots.result.snapshots[0].id, target: restore })
  assert.equal(restored.status, 'succeeded', restored.message)
  const relativeSource = (await fs.realpath(source)).replace(/^\/+/, '')
  assert.equal(await fs.readFile(path.join(restore, relativeSource, 'note.txt'), 'utf8'), 'restic real restore\n')
  checks.push('Restic init, backup, snapshots and restored file content')

  const mediaDir = path.join(temp, 'media-data'), ffmpeg = path.join(root, 'apps/media-tools/dist/engines/ffmpeg/8.0.1/ffmpeg')
  await fs.mkdir(mediaDir)
  const sourceVideo = path.join(temp, 'sample.mp4')
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', sourceVideo], { timeout: 30000 })
  const inspected = await cli('media-tools', mediaDir, { mode: 'inspect', path: sourceVideo })
  assert.equal(inspected.status, 'succeeded', inspected.message)
  const trimmed = await cli('media-tools', mediaDir, { mode: 'trim', path: sourceVideo, start: 0.5, end: 1.5 })
  assert.equal(trimmed.status, 'succeeded', trimmed.message)
  assert((await fs.stat(trimmed.artifacts[0].path)).size > 0)
  const audio = await cli('media-tools', mediaDir, { mode: 'audio', path: sourceVideo })
  assert.equal(audio.status, 'succeeded', audio.message)
  assert.equal(audio.artifacts[0].kind, 'audio')
  checks.push('FFmpeg inspect, trim and audio extraction produce playable files')
  console.log(JSON.stringify({ checks }, null, 2))
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
