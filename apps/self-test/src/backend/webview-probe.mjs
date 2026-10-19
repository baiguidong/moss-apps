import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connection } from './pdf-probe.mjs';

// Read the actual guest renderer, which Playwright's page list omits in Electron.
// This never invokes the App bridge or writes its state.
export async function inspectAppWebview({ endpoint, evidenceDir }, source, { prefix, expectedText = '' }) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(prefix) || new URL(source).protocol !== 'moss-app:') throw new Error('App 页面证据目标无效。');
  const deadline = Date.now() + 20000;
  let client, state;
  try {
    while (Date.now() < deadline) {
      if (!client) {
        const targets = await (await fetch(new URL('/json/list', endpoint))).json();
        const target = targets.find(item => item.type === 'webview' && item.url.split('#')[0] === source.split('#')[0]);
        if (target) client = await connection(target.webSocketDebuggerUrl);
      }
      if (client) {
        state = (await client.call('Runtime.evaluate', { expression: `({ready: document.readyState, text: document.body?.innerText.slice(0, 8000) || '', title: document.title})`, returnByValue: true })).result?.value;
        if (state?.ready === 'complete' && state.text.trim() && (!expectedText || state.text.includes(expectedText))) break;
      }
      await delay(100);
    }
    const evidence = [];
    if (client) {
      const file = path.join(evidenceDir, prefix + '.png');
      await fs.writeFile(file, Buffer.from((await client.call('Page.captureScreenshot')).data, 'base64')); evidence.push(file);
    }
    return { state, evidence, ...(state?.ready !== 'complete' || !state?.text.trim() || (expectedText && !state.text.includes(expectedText)) ? { error: 'App 真实页面在 20 秒内没有显示预期内容。' } : {}) };
  } finally { client?.close(); }
}
