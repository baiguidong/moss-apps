import path from 'node:path'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import os from 'node:os'
export async function runCoreTest(mode) {
  const core = path.resolve(process.env.MOSS_CORE_ROOT || fileURLToPath(new URL('../../../../moss', import.meta.url)))
  const require = createRequire(path.join(core, 'ui/package.json'))
  if (mode === 'agent' && !process.env.MOSS_BUILDER_AGENT_SETTINGS) throw new Error('BLOCKED: set MOSS_BUILDER_AGENT_SETTINGS to an explicitly prepared model settings JSON for the isolated ordinary-Agent test')
  const env = { ...process.env, MOSS_BUILDER_TEST_MODE: mode, MOSS_BUILDER_PACKAGE: fileURLToPath(new URL('../../../artifacts/moss.app-builder/0.1.0/package', import.meta.url)), MOSS_TEST_NODE: process.execPath }
  delete env.ELECTRON_RUN_AS_NODE
  if (process.env.MOSS_CORE_EXECUTABLE) {
    const child = spawn(process.execPath, [path.join(core, 'ui/scripts/test-installed-app-builder.mjs'), ...(mode === 'agent' ? ['--agent'] : [])], { cwd: core, env, stdio: 'inherit' })
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    if (code !== 0) throw new Error(`Installed Builder ${mode} test failed (${code})`)
    return
  }
  await fs.access(path.join(core, 'ui/tests/app-builder.electron.mjs'))
  const completionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builder-completion-'))
  env.MOSS_BUILDER_TEST_COMPLETION_FILE = path.join(completionRoot, 'completed.json')
  try {
    const child = spawn(require('electron'), [path.join(core, 'ui/tests/app-builder.electron.mjs')], { cwd: core, env, stdio: 'inherit' })
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    if (code !== 0) throw new Error(`Builder ${mode} test failed (${code})`)
    const completion = JSON.parse(await fs.readFile(env.MOSS_BUILDER_TEST_COMPLETION_FILE, 'utf8').catch(() => { throw new Error('Core exited without completing the E2E assertions') }))
    if (completion.status !== 'passed' || completion.mode !== mode) throw new Error('Invalid E2E completion marker')
  } finally { await fs.rm(completionRoot, { recursive: true, force: true }) }
}
