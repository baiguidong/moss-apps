// Offline end-to-end test. Temporary keys and Git repositories never leave this fixture.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { repoRoot } from './lib.mjs'
import { copySourceTree } from '../vendor/moss-core/packages/app-runtime/src/packages/source.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-signed-release-test-'))
const invoke = (command, args, cwd = root, env = {}) => execFileSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', timeout: 300000 })
try {
  for (const folder of ['scripts', 'tool-apps/drawio', 'vendor/moss-core/packages/app-sdk', 'vendor/moss-core/packages/app-runtime', 'vendor/moss-core/packages/host-contracts']) {
    await copySourceTree(path.join(repoRoot, folder), path.join(root, folder))
  }
  await fs.mkdir(path.join(root, 'packages'))
  for (const file of ['package.json', 'bun.lock', '.gitignore']) await fs.copyFile(path.join(repoRoot, file), path.join(root, file))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateFile = path.join(root, '.secrets/private.pem')
  await fs.mkdir(path.dirname(privateFile))
  await fs.writeFile(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  await fs.mkdir(path.join(root, 'publishers/moss'), { recursive: true })
  await fs.writeFile(path.join(root, 'publishers/moss/release-1.pem'), publicKey.export({ type: 'spki', format: 'pem' }))
  await fs.writeFile(path.join(root, 'vendor/moss-core/.gitignore'), 'node_modules/\n**/node_modules/\n')
  for (const directory of [path.join(root, 'vendor/moss-core'), root]) {
    invoke('git', ['init', '--quiet'], directory)
    invoke('git', ['-c', 'advice.addEmbeddedRepo=false', 'add', '.'], directory)
    invoke('git', ['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Isolated release fixture'], directory)
  }
  // The trimmed test workspace needs its own lock (never modifies the real lock).
  invoke('bun', ['install', '--lockfile-only'])
  invoke('git', ['add', 'bun.lock'])
  invoke('git', ['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Lock fixture workspaces'])
  invoke('bun', ['install', '--frozen-lockfile'])
  const env = { MOSS_APP_SIGNING_PRIVATE_KEY: '', MOSS_APP_SIGNING_PRIVATE_KEY_FILE: privateFile, MOSS_APP_SIGNING_KEY_ID: 'release-1', GITHUB_REPOSITORY: 'test/apps' }
  invoke('node', ['scripts/package-app.mjs', '--app', 'moss.drawio', '--require-signature'], root, env)
  invoke('node', ['scripts/verify-source-package.mjs', '--app', 'moss.drawio', '--rebuild', '--require-signature'], root, env)
  await fs.writeFile(path.join(root, 'artifacts/check-publication.mjs'), `
    import { execFileSync } from 'node:child_process';
    import { selectApps, repoRoot } from '../scripts/lib.mjs';
    import { collectReleaseAssets } from '../scripts/publish-release.mjs';
    const app = selectApps(['--app', 'moss.drawio'])[0];
    const sha = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
    const files = await collectReleaseAssets(app, repoRoot + '/artifacts/moss.drawio/' + app.manifest.version, sha, 'test/apps');
    if (files.size !== 3) throw new Error('Incomplete assets');
    console.log('Signed MCP source archive and publication inputs verified offline');
  `)
  invoke('node', ['artifacts/check-publication.mjs'], root, env)
} finally { await fs.rm(root, { recursive: true, force: true }) }
