import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

test('every recipe remains executable after the production bundler rewrites functions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moss-bundled-recipes-'));
  try {
    const entry = fileURLToPath(new URL('../src/backend/ui-recipes.mjs', import.meta.url));
    const result = await Bun.build({ entrypoints: [entry], target: 'node', format: 'esm', outdir: directory, naming: 'recipes.mjs' });
    expect(result.success).toBe(true);
    const { buildUiRecipe, scriptedCaseIds } = await import(pathToFileURL(path.join(directory, 'recipes.mjs')).href);
    const run = { id: '11111111-1111-1111-1111-111111111111', targetId: '22222222-2222-2222-2222-222222222222', evidenceDir: '/tmp/evidence with spaces' };
    for (const id of scriptedCaseIds) {
      const source = buildUiRecipe(id, run, [{ id: 'moss.example', name: 'An "App"', enabled: true }]);
      // This is the same expression boundary used by Playwright's VM. In
      // particular, quoted object methods must never leak into this position.
      const fn = new vm.Script(`(${source})`, { filename: `${id}.js` }).runInNewContext();
      expect(typeof fn).toBe('function');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
