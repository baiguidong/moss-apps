#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { CUA_VERSION, CUA_ARTIFACTS, CUA_TOOLS } from '../src/native/manifest.mjs';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find(s => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const target = arg('target') || `${process.platform}-${process.arch}`;
const artifact = CUA_ARTIFACTS[target];
if (!artifact) {
  throw new Error(`Unsupported Computer Use target: ${target}`);
}
const root = path.join(uiRoot, 'dist', 'native', 'resources', 'computer-use');
const output = path.join(root, CUA_VERSION, target);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_VERSION}/${artifact.filename}`;
await fs.mkdir(root, { recursive: true });
const cache = arg('archive') || path.join(os.tmpdir(), 'moss-cua-artifacts', artifact.filename);
let bytes = await fs.readFile(cache).catch(() => null);
if (!bytes) {
  const response = await fetch(source, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Cua download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (hash(bytes) !== artifact.sha256) throw new Error('Cua archive checksum mismatch.');
if (!arg('archive')) {
  await fs.mkdir(path.dirname(cache), { recursive: true });
  await fs.writeFile(cache, bytes);
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-cua-package-'));
try {
  const archive = path.join(temp, artifact.filename);
  await fs.writeFile(archive, bytes);
  const zipped = artifact.filename.endsWith('.zip') ? unzipSync(bytes) : null;
  if (!zipped) execFileSync('tar', ['-xzf', archive, '-C', temp]);
  await fs.mkdir(output, { recursive: true });
  const files = [];
  for (const name of artifact.files) {
    const data = zipped ? Buffer.from(zipped[`${artifact.directory}/${name}`]) : await fs.readFile(path.join(temp, artifact.directory, name));
    await fs.writeFile(path.join(output, name), data, { mode: name.startsWith('cua-') ? 0o755 : 0o644 });
    files.push({ name, size: data.length, sha256: hash(data) });
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: CUA_VERSION, target, source, archiveSha256: artifact.sha256, files }, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'policy.yaml'), JSON.stringify({ allow: { tools: CUA_TOOLS } }, null, 2) + '\n');
  console.log(`Cua ${CUA_VERSION} ${target}: ${files.reduce((n, f) => n + f.size, 0)} bytes staged (no standalone App).`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
