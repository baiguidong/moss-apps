import { test } from 'bun:test'
import { execFileSync } from 'node:child_process'

test('vendored Host and SDK keep runtime response compatibility and installation version gates', () => {
  execFileSync('node', ['--test', 'vendor/moss-core/packages/app-sdk/test/host-response-compatibility.test.mjs'],
    { cwd: new URL('..', import.meta.url), stdio: 'pipe' })
})
