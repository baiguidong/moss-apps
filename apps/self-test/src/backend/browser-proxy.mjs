// Keep useful browser observations in context; retain verbose output on disk.
// The pinned Playwright server still owns all browser operations and schemas.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output-dir');
const outputDir = outputIndex < 0 ? null : args[outputIndex + 1];
const engine = fileURLToPath(new URL('../playwright-cdp/node_modules/@playwright/mcp/cli.js', import.meta.url));
const child = spawn(process.execPath, [engine, ...args], { stdio: ['pipe', 'pipe', 'inherit'] });
process.stdin.pipe(child.stdin);
let buffered = '';
child.stdout.on('data', chunk => {
  buffered += chunk.toString();
  let end;
  while ((end = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
    try {
      const response = JSON.parse(line);
      for (const block of response.result?.content || []) {
        if (block.type !== 'text') continue;
        const original = block.text;
        block.text = original.replace(/\n### Ran Playwright code\n```[^\n]*\n[\s\S]*?\n```\n?/g, '\n');
        if (block.text.length > 12000 && outputDir) {
          const file = path.join(outputDir, `browser-observation-${randomUUID()}.txt`);
          fs.writeFileSync(file, original, { mode: 0o600 });
          block.text = block.text.slice(0, 6000) + `\n[输出较长，完整观察已保存：${file}。需要时 Read 对应部分。]`;
        }
      }
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch { process.stdout.write(line + '\n'); }
  }
});
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.stdin.on('end', stop);
child.on('exit', code => process.exit(code || 0));
child.on('error', error => { process.stderr.write(String(error)); process.exit(1); });
