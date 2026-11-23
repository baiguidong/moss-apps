import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildCommand } from '../src/backend/engine.mjs'

test('trim bounds and raw output placeholder stay in task directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-media-'))
  try {
    const file = path.join(root, "视频 '[]$;&.mp4")
    await fs.writeFile(file, 'test')
    const trim = await buildCommand({ mode: 'trim', path: file, start: 1.2, end: 3.5 }, root)
    assert(trim.args.includes(await fs.realpath(file)))
    assert(trim.args.includes('2.3') || trim.args.includes('2.3000000000000003'))
    await assert.rejects(buildCommand({ mode: 'trim', path: file, start: 3, end: 1 }, root), /结束时间/)
    const raw = await buildCommand({ mode: 'raw', args: ['-i', file, '{output}'], outputName: '结果.mp4' }, root)
    assert.equal(raw.args.at(-1), path.join(root, '结果.mp4'))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
