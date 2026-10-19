// An expendable CDP connection makes cancellation stop queued UI operations.
// Only the App's own materialized programs are passed to this worker.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { inspectNativePdf } from './pdf-probe.mjs';
import { inspectAppWebview } from './webview-probe.mjs';

process.once('message', async ({ engine, endpoint, targetId, script, evidenceDir }) => {
  let browser;
  try {
    const { chromium } = await import(pathToFileURL(engine).href);
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    const page = browser.contexts().flatMap(context => context.pages())
      .find(page => new URL(page.url()).searchParams.get('moss-self-test') === targetId);
    if (!page) throw new Error('本轮测试页面已关闭。');
    const run = new vm.Script(`(${await fs.readFile(script, 'utf8')})`, { filename: script }).runInThisContext();
    const result = await run(page, {
      nativePdf: (target, options = {}) => inspectNativePdf({ endpoint, evidenceDir, prefix: options.prefix, verifyZoom: options.verifyZoom }, target),
      appWebview: (source, options) => inspectAppWebview({ endpoint, evidenceDir }, source, options),
    });
    process.send?.({ result });
  } catch (error) {
    process.send?.({ error: String(error.message || error) });
  } finally {
    await browser?.close().catch(() => {}); // Disconnect; preserve the target.
    process.disconnect?.();
  }
});
