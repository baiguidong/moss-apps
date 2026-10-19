// Declarative connector Apps have no compiled UI or Backend. Validate the
// exact immutable payload; package-app.mjs ships it with its rebuildable source.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateAppPackage, writePackageChecksums } from '@moss/app-runtime/packages'

const root = process.cwd()
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-connector-check-'))
try {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'app.moss.json'), 'utf8'))
  if (!manifest.connectorApp) throw new Error('Expected a Connector App manifest')
  for (const name of ['app.moss.json', 'connector', 'assets', 'README.md']) {
    await fs.cp(path.join(root, name), path.join(temporary, name), { recursive: true }).catch(error => {
      if (error.code !== 'ENOENT' || !['assets', 'README.md'].includes(name)) throw error
    })
  }
  await writePackageChecksums(temporary)
  await validateAppPackage(temporary)
  console.log(`validated ${manifest.id}@${manifest.version}`)
} finally { await fs.rm(temporary, { recursive: true, force: true }) }
