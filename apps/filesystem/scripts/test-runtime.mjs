import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
// Both sides of the MCP transport use the same Node runtime as the shipped App.
for (const [entry, output] of [
  ['src/server/cli.ts', 'dist/server/cli.mjs'],
  ['tests/filesystem-runtime.node.mjs', 'dist/tests/runtime.node.mjs'],
]) execFileSync('bun', ['build', entry, '--target=node', '--format=esm', '--packages=external', `--outfile=${output}`], { cwd, stdio: 'inherit' })
execFileSync(process.execPath, ['--test', 'dist/tests/runtime.node.mjs'], { cwd, stdio: 'inherit', timeout: 120000 })
