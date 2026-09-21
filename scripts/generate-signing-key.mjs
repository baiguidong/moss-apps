import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './lib.mjs'

const privatePath = path.join(repoRoot, '.secrets', 'moss-release-private.pem')
const publicPath = path.join(repoRoot, 'publishers', 'moss', 'release-1.pem')
if ((fs.existsSync(privatePath) || fs.existsSync(publicPath)) && !process.argv.includes('--force')) {
  throw new Error('Signing key already exists; pass --force only when intentionally rotating it')
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
fs.mkdirSync(path.dirname(privatePath), { recursive: true })
fs.mkdirSync(path.dirname(publicPath), { recursive: true })
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 })
console.log(`private key: ${privatePath}`)
console.log(`public key:  ${publicPath}`)
console.log(`next: gh secret set MOSS_APP_SIGNING_PRIVATE_KEY < ${privatePath}`)
