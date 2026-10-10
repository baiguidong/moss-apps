import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendFile = path.join(appRoot, 'dist', 'backend', 'main.mjs')
const uiFile = path.join(appRoot, 'dist', 'ui', 'index.html')

fs.mkdirSync(path.dirname(backendFile), { recursive: true })
fs.mkdirSync(path.dirname(uiFile), { recursive: true })

const result = spawnSync('bun', [
  'build',
  path.join(appRoot, 'src', 'backend', 'feishu', 'index.ts'),
  '--target=node',
  '--format=esm',
  '--define=__dirname=__mossLarkModuleDir',
  '--banner=import { fileURLToPath as __mossFileURLToPath } from "node:url"; const __mossLarkModuleDir = __mossFileURLToPath(new URL("./sdk/lark/lib/", import.meta.url));',
  `--outfile=${backendFile}`,
], {
  cwd: appRoot,
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)

fs.copyFileSync(path.join(appRoot, 'src', 'index.html'), uiFile)

const uiBuild = spawnSync('bun', ['build', fileURLToPath(import.meta.resolve('@moss/app-sdk/ui')), '--target=browser', '--format=esm', `--outfile=${path.join(path.dirname(uiFile), 'app-client.mjs')}`], { cwd: appRoot, stdio: 'inherit' })
if (uiBuild.error) throw uiBuild.error
if (uiBuild.status !== 0) process.exit(uiBuild.status ?? 1)

// Preserve SDK version lookup after bundling, without retaining a build-machine path.
const require = createRequire(import.meta.url)
const sdkMetadata = path.join(path.dirname(backendFile), 'sdk/lark/package.json')
fs.mkdirSync(path.dirname(sdkMetadata), { recursive: true })
fs.copyFileSync(require.resolve('@larksuiteoapi/node-sdk/package.json'), sdkMetadata)
