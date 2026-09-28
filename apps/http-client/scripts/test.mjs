import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const directory = mkdtempSync(join(tmpdir(), 'moss-http-tests-'))
try {
  for (const name of ['trusted', 'untrusted']) {
    const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, `${name}.key`), '-out', join(directory, `${name}.crt`), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' })
    if (generated.error) throw generated.error
    if (generated.status !== 0) throw new Error(`Cannot generate isolated test certificates: ${generated.stderr}`)
  }
  const entry = join(directory, 'request.test.mjs')
  for (const [command, args] of [['bun', ['build', 'tests/request.test.ts', '--target=node', `--outfile=${entry}`]], [process.execPath, ['--test', entry]]]) {
    const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, MOSS_HTTP_TEST_CERTS: directory, NODE_EXTRA_CA_CERTS: join(directory, 'trusted.crt') } })
    if (result.error) throw result.error
    if (result.status !== 0) process.exitCode = result.status || 1
    if (process.exitCode) break
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
