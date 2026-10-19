import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { buildBackend, appRoot } from './engine-build.mjs'
await buildBackend({ api: 'tests/api.mjs' }, path.join(appRoot, 'dist/tests'))
const result = spawnSync(process.execPath, ['--test', 'tests/engine.test.mjs'], { cwd: appRoot, stdio: 'inherit' })
process.exitCode = result.status ?? 1
