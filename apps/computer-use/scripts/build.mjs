import { buildAppSettings } from '@moss/app-settings/build'
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { CUA_ARTIFACTS } from '../src/native/manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.moss.json')));
const target = manifest.platforms?.length === 1 ? manifest.platforms[0] : `${process.platform}-${process.arch}`;
if (!CUA_ARTIFACTS[target]) throw new Error(`Unsupported build target: ${target}`);
const suffix = target.startsWith('win32-') ? `${target}-msvc` : target;
const run = (command, args) => {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) throw r.error || new Error(`${command} failed (${r.status})`);
};
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run('bun', ['x', '--no-install', 'vite', 'build']);
run('bun', ['build', 'src/native/entry.ts', '--target=node', '--format=esm', '--external=@trycua/*', '--outfile=dist/native/entry.mjs']);
run('node', ['scripts/download-driver.mjs', `--target=${target}`]);
fs.rmSync(path.join(root, 'dist/native/resources/computer-use/.cache'), { recursive: true, force: true });

// The native entry resolves its SDK from the installed package, never Core or npm.
const require = createRequire(import.meta.url), copied = new Map();
// Cross builds fetch only pinned target optional packages, authenticated by the
// included lockfile. No dependency downloads occur on the user's machine.
async function fetchOptional(name) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, '../../bun.lock'), 'utf8').replace(/,\s*([}\]])/g, '$1'));
  const tuple = lock.packages[name], integrity = tuple?.[3];
  if (!tuple || !/^sha512-/.test(integrity || '')) throw new Error(`Missing pinned native dependency: ${name}`);
  const version = tuple[0].slice(name.length + 1);
  const key = createHash('sha256').update(integrity).digest('hex');
  const cache = path.join(os.tmpdir(), 'moss-cua-npm', key);
  const tar = path.join(cache, 'package.tgz');
  fs.mkdirSync(cache, { recursive: true });
  let bytes = fs.existsSync(tar) ? fs.readFileSync(tar) : null;
  if (!bytes) {
    const url = `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Native package download failed: ${name} ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error(`Native dependency integrity mismatch: ${name}`);
  fs.writeFileSync(tar, bytes);
  fs.rmSync(path.join(cache, 'package'), { recursive: true, force: true });
  run('tar', ['-xzf', tar, '-C', cache]);
  const file = path.join(cache, 'package/package.json'), pkg = JSON.parse(fs.readFileSync(file));
  if (pkg.name !== name || pkg.version !== version) throw new Error(`Native dependency identity mismatch: ${name}`);
  return file;
}
async function copyPackage(name, resolver) {
  let entry;
  // Some packages export */package.json as a dist package marker. Resolve the
  // actual dependency root so metadata and the complete closure are retained.
  for (const directory of resolver.resolve.paths(name) || []) {
    const file = path.join(directory, name, 'package.json');
    if (fs.existsSync(file)) { entry = fs.realpathSync(file); break; }
  }
  if (!entry && name.endsWith(`-${suffix}`)) entry = await fetchOptional(name);
  if (!entry) throw new Error(`Cannot resolve ${name}`);
  const pkg = JSON.parse(fs.readFileSync(entry));
  if (copied.has(name)) {
    if (copied.get(name) !== pkg.version) throw new Error(`Conflicting dependency ${name}`);
    return;
  }
  copied.set(name, pkg.version);
  fs.cpSync(path.dirname(entry), path.join(root, 'dist/native/node_modules', name), { recursive: true, dereference: true,
    filter: file => path.basename(file) !== 'node_modules' });
  const child = createRequire(entry);
  for (const dependency of Object.keys(pkg.dependencies || {})) await copyPackage(dependency, child);
  for (const dependency of Object.keys(pkg.optionalDependencies || {})) {
    if (dependency.endsWith(`-${suffix}`)) await copyPackage(dependency, child);
  }
}
await copyPackage('@trycua/cua-driver', require);
// MCP and its JS dependencies are bundled. Keep their notices, including
// multiple dependency versions, without flattening incompatible module trees.
const noticed = new Set();
function copyNotices(name, resolver) {
  const file = (resolver.resolve.paths(name) || []).map(dir => path.join(dir, name, 'package.json')).find(file => fs.existsSync(file));
  if (!file) throw new Error(`Cannot resolve notice for ${name}`);
  const entry = fs.realpathSync(file), pkg = JSON.parse(fs.readFileSync(entry)), key = `${name}@${pkg.version}`;
  if (noticed.has(key)) return;
  noticed.add(key);
  const target = path.join(root, 'dist/native/licenses', name, pkg.version);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(entry, path.join(target, 'package.json'));
  for (const item of fs.readdirSync(path.dirname(entry))) {
    if (/^(license|licence|copying|notice)/i.test(item) && fs.statSync(path.join(path.dirname(entry),item)).isFile()) fs.copyFileSync(path.join(path.dirname(entry),item),path.join(target,item));
  }
  for (const dep of Object.keys(pkg.dependencies || {})) copyNotices(dep, createRequire(entry));
}
copyNotices('@modelcontextprotocol/sdk', require);
copyNotices('zod', require);
fs.writeFileSync(path.join(root, 'dist/native/versions.json'), JSON.stringify(Object.fromEntries(copied), null, 2) + '\n');
console.log(`Bundled ${copied.size} packages and pinned Cua 0.34.0`);

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
