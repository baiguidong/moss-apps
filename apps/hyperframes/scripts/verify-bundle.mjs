import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const exec = promisify(execFile)
export async function verifyBundle(root) {
  const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperframes-bundle-'))
  try {
    // No workspace node_modules may satisfy missing dependencies in this check.
    await fs.cp(path.join(root, 'dist/backend'), isolated, { recursive: true })
    const cli = path.join(isolated, 'node_modules/hyperframes/bin/hyperframes.mjs')
    const env = { ...process.env, NODE_PATH: '', HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', DO_NOT_TRACK: '1' }
    await exec(process.execPath, [cli, '--help'], { cwd: isolated, env, timeout: 30000 })
    await exec(process.execPath, [cli, 'render', '--help'], { cwd: isolated, env, timeout: 30000 })
    console.log('Isolated HyperFrames CLI and render imports passed')
  } finally { await fs.rm(isolated, { recursive: true, force: true }) }
}
