import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {runtimeDirectory} from '../apps/code-map/src/backend/engine.mjs'

test('CBM shares a private namespace within an instance and isolates different instances', {skip:process.platform==='win32'}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-cbm-namespace-'))
  const directories = []
  try {
    for (const name of ['ui-and-agent', 'other-instance']) {
      const data = path.join(root, name); await fs.mkdir(data)
      const directory = await runtimeDirectory(data); directories.push(directory)
      assert.equal(await runtimeDirectory(data), directory)
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700)
      assert(directory.length < 50, 'leave room for the upstream Unix socket name')
    }
    assert.notEqual(...directories)
    await fs.chmod(directories[0], 0o777)
    await assert.rejects(runtimeDirectory(path.join(root, 'ui-and-agent')), /权限无效/)
    await fs.rm(directories[0], {recursive:true}); await fs.symlink(root, directories[0])
    await assert.rejects(runtimeDirectory(path.join(root, 'ui-and-agent')), /权限无效/)
  } finally {
    for (const directory of directories) await fs.rm(directory, {recursive:true, force:true})
    await fs.rm(root, {recursive:true, force:true})
  }
})
