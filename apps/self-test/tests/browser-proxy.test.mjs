import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('browser proxy retains errors and images, drops script echoes and bounds observations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-browser-proxy-'));
  let child;
  try {
    const backend = path.join(root, 'backend');
    const engine = path.join(root, 'playwright-cdp/node_modules/@playwright/mcp');
    const output = path.join(root, 'evidence');
    await Promise.all([backend, engine, output].map(dir => fs.mkdir(dir, { recursive: true })));
    await fs.copyFile(new URL('../src/backend/browser-proxy.mjs', import.meta.url), path.join(backend, 'proxy.mjs'));
    const image = { type: 'image', mimeType: 'image/png', data: 'untouched' };
    const payload = { jsonrpc: '2.0', id: 7, result: { isError: true, content: [
      { type: 'text', text: '### Result\nLocator failed\n### Ran Playwright code\n```js\nlargeRepeatedScript();\n```\n### Page\nSnapshot retained' },
      image, { type: 'text', text: 'observed '.repeat(2000) },
    ] } };
    await fs.writeFile(path.join(engine, 'cli.js'), `process.stdout.write(${JSON.stringify(JSON.stringify(payload) + '\n')});`);
    child = spawn(process.execPath, [path.join(backend, 'proxy.mjs'), '--output-dir', output]);
    let text = ''; child.stdout.on('data', chunk => { text += chunk; });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const actual = JSON.parse(text);
    expect(actual.id).toBe(7); expect(actual.result.isError).toBe(true);
    expect(actual.result.content[0].text).toContain('Locator failed');
    expect(actual.result.content[0].text).toContain('Snapshot retained');
    expect(actual.result.content[0].text).not.toContain('largeRepeatedScript');
    expect(actual.result.content[1]).toEqual(image);
    expect(actual.result.content[2].text.length).toBeLessThan(6500);
    const [file] = await fs.readdir(output);
    expect(await fs.readFile(path.join(output, file), 'utf8')).toBe(payload.result.content[2].text);
  } finally { child?.kill(); await fs.rm(root, { recursive: true, force: true }); }
});
