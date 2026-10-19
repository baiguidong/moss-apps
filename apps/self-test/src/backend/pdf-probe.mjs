import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function connection(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  return { close: () => socket.close(), call: (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('PDF CDP 操作超时')); }, 5000);
    const receive = event => {
      const message = JSON.parse(event.data);
      if (message.id !== requestId) return;
      clearTimeout(timer); socket.removeEventListener('message', receive);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    };
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  }) };
}

// Read the native PDF viewer's actual shadow DOM. Its content is not part of
// the outer preview page; absence of an outer canvas is not a rendering error.
export async function inspectNativePdf({ endpoint, evidenceDir, prefix = 'preview-pdf', verifyZoom = true }, expectedFile) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(prefix)) throw new Error('PDF 证据文件名前缀无效。');
  const deadline = Date.now() + 20000;
  let client, state;
  const snapshot = `(() => {
    const viewer = document.querySelector('pdf-viewer');
    const root = viewer?.shadowRoot;
    if (!root) return null;
    const nodes = [];
    const visit = root => { for (const node of root.querySelectorAll('*')) { nodes.push(node); if (node.shadowRoot) visit(node.shadowRoot); } };
    visit(root);
    const plugin = root.querySelector('embed');
    const toolbar = root.querySelector('viewer-toolbar');
    const text = nodes.filter(n => n.children.length === 0 && !['STYLE','SCRIPT'].includes(n.tagName)).map(n => n.textContent?.trim()).filter(Boolean).join(' ');
    const fields = nodes.filter(n => n.tagName === 'INPUT').map(n => ({id:n.id, value:n.value, label:n.getAttribute('aria-label')}));
    const zoom = nodes.find(n => /zoom-in|zoomIn/.test(n.id) || /放大|Zoom in/i.test(n.getAttribute('aria-label') || ''));
    const box = zoom?.getBoundingClientRect();
    return {original:plugin?.getAttribute('original-url'),text:text.slice(0,3000),fields,
      loading:toolbar?.hasAttribute('loading_'),
      zoom:box?.width > 0 ? {x:box.x + box.width/2,y:box.y + box.height/2} : null};
  })()`;
  try {
    while (Date.now() < deadline) {
      if (!client) {
        const targets = await (await fetch(new URL('/json/list', endpoint))).json();
        for (const target of targets.filter(t => t.type === 'webview' && t.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))) {
          const candidate = await connection(target.webSocketDebuggerUrl);
          const value = (await candidate.call('Runtime.evaluate', { expression: snapshot, returnByValue: true })).result?.value;
          if (value?.original && decodeURIComponent(new URL(value.original).pathname) === expectedFile) { client = candidate; state = value; break; }
          candidate.close();
        }
      } else state = (await client.call('Runtime.evaluate', { expression: snapshot, returnByValue: true })).result?.value;
      if (state && !state.loading && state.fields.some(f => /page/i.test(f.id) && f.value === '1')) break;
      await delay(100);
    }
    const evidence = [];
    if (client) {
      const file = path.join(evidenceDir, prefix + '-native.png');
      const { data } = await client.call('Page.captureScreenshot');
      await fs.writeFile(file, Buffer.from(data, 'base64')); evidence.push(file);
    }
    if (!state || state.loading || !state.fields.some(f => /page/i.test(f.id) && f.value === '1')) {
      return { error: '原生 PDF 查看器在 20 秒内未完成加载或未显示第 1 页。', state, evidence };
    }
    if (!verifyZoom) return { state, evidence };
    if (!state.zoom) return { error: '原生 PDF 页码已就绪，但缩放控件不可操作。', state, evidence };
    if (!/\/\s*1(?:\s|$)/.test(state.text)) return { error: '原生 PDF 总页数与单页样例不一致。', state, evidence };
    await fs.writeFile(path.join(evidenceDir, prefix + '-state.json'), JSON.stringify(state, null, 2));
    const before = state.fields.find(f => /zoom|缩放/i.test(f.id + (f.label || '')))?.value;
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...state.zoom, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...state.zoom, button: 'left', clickCount: 1 });
    let after;
    const zoomDeadline = Date.now() + 5000;
    do {
      state = (await client.call('Runtime.evaluate', { expression: snapshot, returnByValue: true })).result?.value;
      after = state?.fields.find(f => /zoom|缩放/i.test(f.id + (f.label || '')))?.value;
      if (before && after && after !== before) break;
      await delay(100);
    } while (Date.now() < zoomDeadline);
    await fs.writeFile(path.join(evidenceDir, prefix + '-state-after.json'), JSON.stringify(state, null, 2));
    if (!before || !after || before === after) return { error: '点击原生 PDF 放大后缩放数值未改变。', state, evidence };
    const file = path.join(evidenceDir, prefix + '-zoomed.png');
    await fs.writeFile(file, Buffer.from((await client.call('Page.captureScreenshot')).data, 'base64')); evidence.push(file);
    return { state, before, after, evidence };
  } finally { client?.close(); }
}
