import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { ensurePrivateDirectory, readPrivateFile, writePrivateFileAtomic, withPrivateFileLockSync } from '../vendor/moss-core/shared/security/credential-crypto.mjs'

export function prepareIsolatedDbxProfile(directory) {
  const root = path.resolve(directory)
  fs.mkdirSync(path.dirname(root), { recursive: true })
  try { fs.mkdirSync(root, { mode: 0o700 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('DBX profile must be a real directory')
  ensurePrivateDirectory(root)
  const keyDirectory = path.join(root, '.dbx')
  const keyFile = path.join(keyDirectory, 'secret.key')
  return withPrivateFileLockSync(path.join(root, '.provision'), () => {
    if (fs.existsSync(keyFile)) {
      if (!/^[a-f0-9]{64}\s*$/i.test(readPrivateFile(keyFile).toString('utf8'))) throw new Error('Existing DBX key is invalid; restore it instead of replacing it')
    } else {
      if (fs.readdirSync(root).some(name => name !== '.provision.lock')) throw new Error('DBX profile is not empty; refusing to generate a replacement key')
      ensurePrivateDirectory(keyDirectory)
      writePrivateFileAtomic(keyFile, randomBytes(32).toString('hex') + '\n')
    }
    return { DBX_DATA_DIR: root, DBX_SECRET_KEY_FILE: keyFile }
  })
}
