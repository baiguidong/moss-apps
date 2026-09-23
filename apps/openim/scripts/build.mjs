import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendFile = path.join(appRoot, 'dist', 'backend', 'main.mjs')
const backendRoot = path.dirname(backendFile)
const marketplace = JSON.parse(fs.readFileSync(path.join(appRoot, 'marketplace.json'), 'utf8'))
const nativePlatforms = Object.freeze({
  'darwin-arm64': { openim: 'mac_arm64', koffi: 'darwin_arm64' },
  'darwin-x64': { openim: 'mac_x64', koffi: 'darwin_x64' },
  'win32-x64': { openim: 'win_x64', koffi: 'win32_x64' },
})
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
for (const platform of marketplace.platforms || []) {
  const directories = nativePlatforms[platform]
  if (!directories) throw new Error(`OpenIM build does not define native assets for ${platform}`)
  const openIMSource = path.join(sdkRoot, 'assets', directories.openim)
  const openIMDestination = path.join(backendRoot, 'native', directories.openim)
  fs.mkdirSync(openIMDestination, { recursive: true })
  for (const name of fs.readdirSync(openIMSource)) {
    if (name === '.gitkeep') continue
    fs.copyFileSync(path.join(openIMSource, name), path.join(openIMDestination, name))
  }
  const koffiDestination = path.join(packagedKoffiRoot, 'build', 'koffi', directories.koffi)
  fs.mkdirSync(koffiDestination, { recursive: true })
  fs.copyFileSync(
    path.join(koffiRoot, 'build', 'koffi', directories.koffi, 'koffi.node'),
    path.join(koffiDestination, 'koffi.node'),
  )
}
