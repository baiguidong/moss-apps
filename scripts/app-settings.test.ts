import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listApps, repoRoot } from './lib.mjs';
import { exportAppSource, parseLock } from './source-package.mjs';

test('every tool App declares and builds the shared settings page while retaining its own default scope', async () => {
  const apps = listApps().filter(app => app.kind === 'app' && (app.manifest.contributes?.tools?.length || app.manifest.host?.protocols?.includes('moss.mcp/v1')));
  expect(apps.length).toBe(13);
  for (const app of apps) {
    const view = app.manifest.contributes.views.find(view => view.route === '#/moss-settings');
    expect(view).toBeTruthy();
    expect(app.manifest.contributes.settings.find(setting => setting.viewId === view.id)?.order).toBe(-1000);
    expect(app.manifest.host.protocols).toContain('moss.host/v1');
    const pkg = JSON.parse(await fs.readFile(path.join(app.root, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@moss/app-settings']).toBe('workspace:*');
    expect(await fs.readFile(path.join(app.root, 'scripts/build.mjs'), 'utf8')).toContain("from '@moss/app-settings/build'");
    if (app.manifest.host.protocols.includes('moss.mcp/v1')) expect(app.manifest.permissions).toContain('mcp:read');
  }
  expect(apps.find(app => app.manifest.id === 'moss.knowledge-rag').manifest.toolScope).toBe('session');
  expect(apps.find(app => app.manifest.id === 'moss.sequential-thinking').manifest.toolScope).toBe('global');
});

test('source exports carry the shared module and its pinned dependencies for independent rebuilds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-settings-source-'));
  try {
    const app = listApps().find(app => app.manifest.id === 'moss.mcp');
    await exportAppSource(app, root);
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.workspaces).toContain('packages/app-settings');
    const lock = parseLock(await fs.readFile(path.join(root, 'bun.lock'), 'utf8'));
    expect(lock.packages['@moss/app-settings']).toEqual(['@moss/app-settings@workspace:packages/app-settings']);
    expect(lock.packages.tailwindcss).toBeTruthy();
    const shared = await fs.readFile(path.join(root, 'packages/app-settings/src/main.tsx'), 'utf8');
    expect(shared).toContain('createRoot');
    expect(shared).not.toContain(repoRoot);
    expect(await fs.readFile(path.join(root, 'packages/app-settings/src/api.ts'), 'utf8')).not.toContain('agentDesktop');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
