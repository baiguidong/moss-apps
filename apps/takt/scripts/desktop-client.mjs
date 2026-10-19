import { chromium } from '@playwright/test'
export async function connectDesktop() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const desktop = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('/renderer/'))
  if (!desktop) throw new Error('Moss 主窗口不存在')
  const target = (await fetch('http://127.0.0.1:9223/json/list').then(r => r.json()))[0]
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const pending = new Map(); let sequence = 0
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data), request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id); clearTimeout(request.timer)
    if (response.error || response.result.exceptionDetails) request.reject(new Error(JSON.stringify(response.error || response.result.exceptionDetails)))
    else request.resolve(response.result.result?.value)
  })
  const main = expression => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Main inspector timeout')) }, 30000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  return { browser, desktop, main, close: async () => { socket.close(); await browser.close() } }
}
export async function waitFor(action, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await action(); if (result) return result; await new Promise(r => setTimeout(r, 300)) }
  throw new Error('等待超时')
}
// Electron webview guests do not appear in Playwright's page list.
export async function connectConversationGuest() {
  const target = await waitFor(async () => (await fetch('http://127.0.0.1:9222/json/list').then(r => r.json())).find(t => t.type === 'webview' && t.url.includes('#/conversation')))
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(), errors = []
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let sequence = 0
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data)
    if (response.method === 'Runtime.exceptionThrown') errors.push(response.params.exceptionDetails)
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id); clearTimeout(request.timer)
    if (response.error || response.result?.exceptionDetails) request.reject(new Error(JSON.stringify(response.error || response.result.exceptionDetails)))
    else request.resolve(response.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Guest inspector timeout')) }, 30000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
  await send('Runtime.enable')
  await waitFor(() => evaluate('Boolean(document.body && document.querySelector(".react-flow__node"))').catch(() => false))
  return { id: target.id, evaluate, errors, close: () => socket.close() }
}
export async function captureDesktop(main, file) {
  const { writeFile } = await import('node:fs/promises')
  // CDP Page.captureScreenshot mis-scales Electron guest surfaces on Retina.
  const png = await main(`(async()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/'));return (await w.webContents.capturePage()).toPNG().toString('base64')})()`)
  await writeFile(file, Buffer.from(png, 'base64'))
}
