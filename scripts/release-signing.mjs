import fs from 'node:fs'
import path from 'node:path'

export function signingKeyFromEnvironment() {
  const keyFile = String(process.env.MOSS_APP_SIGNING_PRIVATE_KEY_FILE || '').trim()
  if (keyFile) return fs.readFileSync(path.resolve(keyFile), 'utf8')
  const raw = String(process.env.MOSS_APP_SIGNING_PRIVATE_KEY || '').trim()
  if (!raw) return ''
  return raw.includes('BEGIN PRIVATE KEY') ? raw : Buffer.from(raw, 'base64').toString('utf8')
}
