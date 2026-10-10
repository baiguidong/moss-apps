import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { zipSync } from 'fflate'
import os from 'node:os'
import { verifySourceArchive } from './verify-source-package.mjs'
import { exportAppSource, run } from './source-package.mjs'
import { attachSourcePackage, validateSourcePackage, copySourceTree, sourceFileList } from '../vendor/moss-core/packages/app-runtime/src/packages/source.mjs'
import { verifyPackageRuntime } from '../vendor/moss-core/packages/app-runtime/src/packages/verify-runtime.mjs'
import {
  artifactsRoot,
  canonicalChecksums,
  hasOption,
  listFiles,
  readJson,
  releaseNotesForVersion,
  repoRoot,
  selectApps,
  sha256Hex,
  sha256Integrity,
  signaturePayload,
  validateRepositoryAppToolSchemas,
  writeJson,
} from './lib.mjs'

const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')

function signingKeyFromEnvironment() {
  const keyFile = String(process.env.MOSS_APP_SIGNING_PRIVATE_KEY_FILE || '').trim()
  if (keyFile) return fs.readFileSync(path.resolve(keyFile), 'utf8')
  const raw = String(process.env.MOSS_APP_SIGNING_PRIVATE_KEY || '').trim()
  if (!raw) return ''
  return raw.includes('BEGIN PRIVATE KEY') ? raw : Buffer.from(raw, 'base64').toString('utf8')
}

async function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return
  await fsp.cp(source, destination, { recursive: true })
}

async function createChecksums(packageRoot) {
  const entries = await listFiles(packageRoot, { excluded: ['checksums.json', 'app-signature.json'] })
  return canonicalChecksums(Object.fromEntries(await Promise.all(entries.map(async (entry) => [
    entry.relativePath,
    sha256Integrity(await fsp.readFile(entry.absolutePath)),
  ]))))
}

async function verifyPackageDirectory(packageRoot, manifest, expectedSignature) {
  validateRepositoryAppToolSchemas(packageRoot, manifest)
  const declared = readJson(path.join(packageRoot, 'checksums.json'))
  const actual = await createChecksums(packageRoot)
  if (JSON.stringify(declared) !== JSON.stringify(actual)) throw new Error('Generated package checksums are inconsistent')
  for (const requiredPath of [manifest.ui?.entry, manifest.backend?.entry]) {
    if (requiredPath && !fs.existsSync(path.join(packageRoot, requiredPath))) {
      throw new Error(`Built package is missing ${requiredPath}`)
    }
  }
  if (expectedSignature) {
    const publicKeyPath = path.join(repoRoot, 'publishers', expectedSignature.publisherId, `${expectedSignature.keyId}.pem`)
    if (!fs.existsSync(publicKeyPath)) throw new Error(`Missing release public key: ${publicKeyPath}`)
    const valid = verify(
      null,
      signaturePayload(manifest, actual, expectedSignature),
      fs.readFileSync(publicKeyPath),
      Buffer.from(expectedSignature.signature, 'base64'),
    )
    if (!valid) throw new Error('Generated App signature does not match the committed public key')
  }
}

async function packageApp(app, options) {
  // --skip-build cannot reuse an unbound dist directory. Always build the exact
  // exported snapshot that ships with this version.
  const privateKeyPem = signingKeyFromEnvironment()
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-source-build-'))
  try {
  const sourceRoot = path.join(temporary, 'source')
  const spec = await exportAppSource(app, sourceRoot, { release: options.requireSignature || Boolean(privateKeyPem) })
  const builtApp = path.join(sourceRoot, spec.appRoot)
  const frozenSource = path.join(temporary, 'frozen')
  await copySourceTree(sourceRoot, frozenSource)
  const sourceHash = sha256Hex(Buffer.from(JSON.stringify(await sourceFileList(frozenSource))))
  run('bun', ['install', '--frozen-lockfile'], sourceRoot)
  for (const script of ['check', 'test', 'build']) if (spec.commands[script]) run('bun', ['run', script], builtApp)
  const after = path.join(temporary, 'after')
  await copySourceTree(sourceRoot, after)
  if (sha256Hex(Buffer.from(JSON.stringify(await sourceFileList(after)))) !== sourceHash) throw new Error('Build or tests changed source inputs; regenerate and commit them before packaging')

  const outputDir = path.join(artifactsRoot, app.manifest.id, app.manifest.version)
  const packageRoot = path.join(outputDir, 'package')
  await fsp.rm(outputDir, { recursive: true, force: true })
  await fsp.mkdir(packageRoot, { recursive: true })

  for (const directory of ['dist', 'schemas', 'assets', 'resources']) {
    await copyIfPresent(path.join(builtApp, directory), path.join(packageRoot, directory))
  }
  for (const fileName of ['README.md', 'LICENSE', 'LICENSE.md']) {
    await copyIfPresent(path.join(builtApp, fileName), path.join(packageRoot, fileName))
  }
  await writeJson(path.join(packageRoot, 'app.moss.json'), app.manifest)

  const sourceDescriptor = await attachSourcePackage(packageRoot, frozenSource, { appRoot: spec.appRoot, origin: spec.origin, sdk: spec.sdk })
  const verification = await verifyPackageRuntime(packageRoot, { nodeExecutable: process.execPath })
  await validateSourcePackage(packageRoot, { required: true })
  const checksums = await createChecksums(packageRoot)
  await writeJson(path.join(packageRoot, 'checksums.json'), checksums)

  let signatureMetadata = null
  if (privateKeyPem) {
    if (!app.manifest.publisher?.id) throw new Error(`${app.manifest.id} must declare publisher.id before signing`)
    const keyId = String(process.env.MOSS_APP_SIGNING_KEY_ID || 'release-1').trim()
    const privateKey = createPrivateKey(privateKeyPem)
    const publicKey = createPublicKey(privateKey)
    signatureMetadata = {
      schemaVersion: 1,
      algorithm: 'ed25519',
      publisherId: app.manifest.publisher.id,
      keyId,
      signature: sign(null, signaturePayload(app.manifest, checksums, {
        publisherId: app.manifest.publisher.id,
        keyId,
      }), privateKey).toString('base64'),
    }
    const committedPublicKeyPath = path.join(repoRoot, 'publishers', app.manifest.publisher.id, `${keyId}.pem`)
    if (!fs.existsSync(committedPublicKeyPath)) throw new Error(`Missing committed public key: ${committedPublicKeyPath}`)
    const committedPublicKey = createPublicKey(fs.readFileSync(committedPublicKeyPath, 'utf8'))
    if (publicKey.export({ type: 'spki', format: 'pem' }).toString() !== committedPublicKey.export({ type: 'spki', format: 'pem' }).toString()) {
      throw new Error(`Signing key does not match ${committedPublicKeyPath}`)
    }
    await writeJson(path.join(packageRoot, 'app-signature.json'), signatureMetadata)
  } else if (options.requireSignature) {
    throw new Error('MOSS_APP_SIGNING_PRIVATE_KEY or MOSS_APP_SIGNING_PRIVATE_KEY_FILE is required')
  }

  await verifyPackageDirectory(packageRoot, app.manifest, signatureMetadata)
  const zipEntries = {}
  for (const entry of await listFiles(packageRoot)) {
    zipEntries[entry.relativePath] = [new Uint8Array(await fsp.readFile(entry.absolutePath)), { mtime: FIXED_ZIP_TIME }]
  }
  const archive = Buffer.from(zipSync(zipEntries, { level: 9 }))
  const fileName = `${app.manifest.id}-${app.manifest.version}.zip`
  const zipPath = path.join(outputDir, fileName)
  const checksum = sha256Hex(archive)
  await fsp.writeFile(zipPath, archive)
  await verifySourceArchive(zipPath, { requireSignature: options.requireSignature })
  await fsp.writeFile(path.join(outputDir, `${app.manifest.id}-${app.manifest.version}.sha256`), `${checksum}  ${fileName}\n`, 'utf8')

  const repository = String(process.env.GITHUB_REPOSITORY || 'baiguidong/moss-apps').trim()
  const tag = `${app.manifest.id}-v${app.manifest.version}`
  const release = {
    schemaVersion: 1,
    app: {
      id: app.manifest.id,
      displayName: app.manifest.displayName,
      summary: app.marketplace.summary,
      description: app.marketplace.description,
      publisher: app.manifest.publisher,
      categories: app.marketplace.categories,
      keywords: app.marketplace.keywords,
      homepage: app.marketplace.homepage,
      repository: app.marketplace.repository,
      license: app.marketplace.license,
      featured: app.marketplace.featured,
      iconPath: app.manifest.icon || '',
    },
    version: {
      version: app.manifest.version,
      hostApi: app.manifest.hostApi,
      platforms: app.marketplace.platforms,
      permissions: app.manifest.permissions,
      publishedAt: process.env.MOSS_APP_PUBLISHED_AT || new Date().toISOString(),
      releaseNotes: releaseNotesForVersion(app.root, app.manifest.version),
      artifact: {
        sourceIncluded: true, sourceFormat: 1, sourceHash: sourceDescriptor.sourceHash,
        fileName,
        downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${fileName}`,
        sha256: checksum,
        size: archive.length,
        signed: Boolean(signatureMetadata),
        publisherId: signatureMetadata?.publisherId || null,
        keyId: signatureMetadata?.keyId || null,
      },
    },
  }
  const releasePath = path.join(outputDir, `${app.manifest.id}-${app.manifest.version}.release.json`)
  await writeJson(releasePath, release)
  console.log(JSON.stringify({ appId: app.manifest.id, version: app.manifest.version, zipPath, releasePath, sha256: checksum, sourceHash: sourceDescriptor.sourceHash, verification }))
  return release
  } finally { await fsp.rm(temporary, { recursive: true, force: true }) }
}

const argv = process.argv.slice(2)
const options = {
  requireSignature: hasOption(argv, '--require-signature'),
  skipBuild: hasOption(argv, '--skip-build'),
}
const apps = selectApps(argv)
if (!apps.length) throw new Error('No Apps found under apps/')
for (const app of apps) await packageApp(app, options)
