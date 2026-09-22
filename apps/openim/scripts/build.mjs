import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendFile = path.join(appRoot, 'dist', 'backend', 'main.mjs')
const backendRoot = path.dirname(backendFile)
fs.rmSync(backendRoot, { recursive: true, force: true })
fs.mkdirSync(path.dirname(backendFile), { recursive: true })

for (const command of [
  ['vite', ['build']],
  ['bun', [
    'build',
    path.join(appRoot, 'src', 'backend', 'main.ts'),
    '--target=node',
    '--format=esm',
    '--external=koffi',
    `--outfile=${backendFile}`,
  ]],
]) {
  const result = spawnSync(command[0], command[1], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const require = createRequire(import.meta.url)
const sdkPackage = fs.realpathSync(require.resolve('@openim/node-client-sdk/package.json'))
const sdkRoot = path.dirname(sdkPackage)
const sdkRequire = createRequire(sdkPackage)
const koffiRoot = path.dirname(fs.realpathSync(sdkRequire.resolve('koffi/package.json')))
const packagedKoffiRoot = path.join(backendRoot, 'node_modules', 'koffi')
fs.mkdirSync(packagedKoffiRoot, { recursive: true })
for (const name of ['package.json', 'index.js', 'indirect.js']) {
  fs.copyFileSync(path.join(koffiRoot, name), path.join(packagedKoffiRoot, name))
}
fs.cpSync(path.join(koffiRoot, 'build', 'koffi'), path.join(packagedKoffiRoot, 'build', 'koffi'), { recursive: true })
fs.cpSync(path.join(sdkRoot, 'assets'), path.join(backendRoot, 'native'), { recursive: true })
