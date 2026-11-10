import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'moss-http-tests-')))
const coreRoot = existsSync(join(process.cwd(), '../../vendor/moss-core'))
  ? join(process.cwd(), '../../vendor/moss-core')
  : existsSync(join(process.cwd(), '../../.moss-sdk'))
    ? join(process.cwd(), '../../.moss-sdk')
    : undefined
try {
  for (const name of ['trusted', 'untrusted']) {
    const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, `${name}.key`), '-out', join(directory, `${name}.crt`), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' })
    if (generated.error) throw generated.error
    if (generated.status !== 0) throw new Error(`Cannot generate isolated test certificates: ${generated.stderr}`)
  }
  const requestTests = join(directory, 'request.test.mjs'), hostTests = join(directory, 'host.test.mjs'), backend = join(directory, 'backend.mjs')
  for (const [command, args] of [
    ['bun', ['build', 'tests/http/request.test.ts', '--target=node', `--outfile=${requestTests}`]],
    ['bun', ['build', 'tests/http/host.test.ts', '--target=node', `--outfile=${hostTests}`]],
    ['bun', ['build', 'src/backend/main.ts', '--target=node', `--outfile=${backend}`]],
    [process.execPath, ['--test', requestTests, hostTests]],
  ]) {
    const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...(coreRoot ? { MOSS_CORE_ROOT: coreRoot } : {}), MOSS_HTTP_TEST_CERTS: directory, MOSS_HTTP_TEST_BACKEND: backend, NODE_EXTRA_CA_CERTS: join(directory, 'trusted.crt') } })
    if (result.error) throw result.error
    if (result.status !== 0) process.exitCode = result.status || 1
    if (process.exitCode) break
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
