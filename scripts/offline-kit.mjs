import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, sign, verify } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { repoRoot, selectApps, writeJson } from './lib.mjs'
import { signingKeyFromEnvironment } from './release-signing.mjs'

export function kitPayload(id, version, platform, kit) {
  return Buffer.from(JSON.stringify(['moss.offline-kit/v1', id, version, platform, kit.publisherId, kit.keyId, kit.fileName, kit.appSha256, kit.sha256, kit.size]))
}

export async function checkOfflineKit(app, root, platform, base, kit) {
  const { id, version, publisher } = app.manifest
  const stem = base.fileName.slice(0, -4) + '-offline-' + platform
  if (!base.signed || kit.fileName !== stem + '.zip' || kit.publisherId !== publisher.id || kit.keyId !== base.keyId
      || !/^[\w.-]+$/.test(kit.keyId) || kit.appSha256 !== base.sha256 || !/^[a-f0-9]{64}$/.test(kit.sha256)
      || kit.downloadUrl !== new URL(kit.fileName, base.downloadUrl).href) throw new Error('Invalid offline kit identity')
  const publicKey = await fs.readFile(path.join(repoRoot, 'publishers', publisher.id, kit.keyId + '.pem'))
  if (!verify(null, kitPayload(id, version, platform, kit), publicKey, Buffer.from(kit.signature, 'base64'))) throw new Error('Invalid offline kit signature')
  const file = path.join(root, kit.fileName)
  const checksum = await fs.readFile(path.join(root, stem + '.sha256'), 'utf8')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  if (kit.size !== (await fs.stat(file)).size || digest.digest('hex') !== kit.sha256 || checksum.trim() !== kit.sha256 + '  ' + kit.fileName) throw new Error('Offline kit bytes or checksum mismatch')
  // Check the nested, immutable online ZIP and transfer instructions before publication.
  execFileSync('python3', ['-c', `import hashlib,json,sys,zipfile
file,name,digest,app,version,platform=sys.argv[1:]
with zipfile.ZipFile(file) as z:
    info=json.loads(z.read("offline.json"))
    assert (info["format"],info["appId"],info["version"],info["platform"])==(1,app,version,platform)
    assert z.namelist().count(name)==1 and len(z.namelist())==len(set(z.namelist()))
    with z.open(name) as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest()==digest`, file, base.fileName, base.sha256, id, version, platform])
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , id, version, platform] = process.argv
  const app = selectApps(['--app', id])[0]
  if (app.manifest.version !== version || !app.marketplace.offlineKitPlatforms?.includes(platform)) throw new Error('Unknown offline kit target')
  const root = path.join(repoRoot, 'artifacts', id, version)
  const stem = id + '-' + version + (app.manifest.platforms ? '-' + platform : '')
  const record = JSON.parse(await fs.readFile(path.join(root, stem + '.release.json')))
  const base = record.version.artifacts?.[platform] || record.version.artifact
  const kitStem = stem + '-offline-' + platform
  const fileName = kitStem + '.zip'
  const kit = { fileName, downloadUrl: new URL(fileName, base.downloadUrl).href, size: (await fs.stat(path.join(root, fileName))).size,
    sha256: (await fs.readFile(path.join(root, kitStem + '.sha256'), 'utf8')).split(' ')[0],
    appSha256: base.sha256, publisherId: base.publisherId, keyId: base.keyId }
  kit.signature = sign(null, kitPayload(id, version, platform, kit), signingKeyFromEnvironment()).toString('base64')
  await checkOfflineKit(app, root, platform, base, kit)
  await writeJson(path.join(root, kitStem + '.kit.json'), kit)
}
