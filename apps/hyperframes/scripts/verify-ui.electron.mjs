import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import fs from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), 'moss-hyperframes-ui-'))
const output = process.env.MOSS_HYPERFRAMES_OUTPUT || path.join(temp, 'evidence')
const uiRoot = process.env.MOSS_HYPERFRAMES_UI || path.join(root, 'dist')
const playwrightModule = process.env.MOSS_PLAYWRIGHT_MODULE || 'playwright'
const requests = []
const errors = []
let window
app.setPath('userData', path.join(temp, 'user-data'))
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', '0')
app.on('window-all-closed', () => {})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitForFile = async (file, timeout = 10000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { try { return await fs.readFile(file, 'utf8') } catch { await sleep(50) } }
  throw new Error(`Timed out waiting for ${file}`)
}
const portFromDevTools = async () => Number((await waitForFile(path.join(temp, 'user-data', 'DevToolsActivePort'))).split('\n')[0])
const child = (port, script) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MOSS_PLAYWRIGHT_MODULE: playwrightModule }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = '', err = ''; p.stdout.on('data', x => { out += x }); p.stderr.on('data', x => { err += x })
  p.on('error', reject); p.on('close', code => code ? reject(new Error(err || out || `CDP child exited ${code}`)) : resolve(out))
})
try {
  await fs.mkdir(output, { recursive: true })
  await app.whenReady()
  const preload = path.join(temp, 'preload.cjs')
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('mossApp',{app:{getInfo:()=>ipcRenderer.invoke('hyperframes:info')},host:{request:(protocol,method,input)=>ipcRenderer.invoke('hyperframes:request',{protocol,method,input}),cancel:(id)=>ipcRenderer.invoke('hyperframes:cancel',id)},events:{on:(name,cb)=>{const f=(_,v)=>cb(v);ipcRenderer.on('hyperframes:event:'+name,f);return()=>ipcRenderer.removeListener('hyperframes:event:'+name,f)}}});`)
  let job = null
  ipcMain.handle('hyperframes:info', () => ({ appearance: { themeMode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', cssThemeId: 'default' } }))
  ipcMain.handle('hyperframes:request', async (_event, payload) => {
    requests.push(payload)
    if (payload.method === 'render.cancel') return { ok: true, result: { canceled: true } }
    if (payload.method === 'render.start') { job = { id: `verify-${Date.now()}`, status: 'running' }; return { ok: true, result: job } }
    if (payload.method === 'render.status') return { ok: true, result: job || { status: 'idle' } }
    return { ok: true, result: {} }
  })
  ipcMain.handle('hyperframes:cancel', () => ({ ok: true }))
  window = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })
  window.webContents.on('console-message', e => { if (e.level === 3) errors.push(e.message) })
  await window.loadFile(path.join(uiRoot, 'index.html'))
  const port = await portFromDevTools()
  const script = `import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import { chromium } from ${JSON.stringify(playwrightModule)};
const browser=await chromium.connectOverCDP('http://127.0.0.1:${port}',{timeout:10000}); const pages=browser.contexts().flatMap(c=>c.pages()); const page=pages.find(p=>p.url().includes('index.html'))||pages[0]; assert(page,'HyperFrames page missing');
const wait=async fn=>{for(let i=0;i<160;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('UI condition timed out')};
await wait(()=>page.locator('#root').count()===1); const body=page.locator('body'); assert((await body.innerText()).trim(),'HyperFrames UI is empty');
const input=page.locator('textarea,input[type=text]').first(); if(await input.count()){await input.fill('创建一个中文离线示例');}
const start=page.getByRole('button',{name:/创建|生成|渲染|开始/}).first(); if(await start.count()) await start.click();
await wait(async()=>{const text=await body.innerText();return /中文|离线|渲染|项目|时间线/.test(text)});
const video=page.locator('video').first(); if(await video.count()){await video.waitFor({state:'attached'}); await page.screenshot({path:${JSON.stringify(path.join(output, 'hyperframes-wide.png'))},fullPage:true}); const narrow=page.setViewportSize({width:420,height:800}); await narrow; await page.screenshot({path:${JSON.stringify(path.join(output, 'hyperframes-narrow.png'))},fullPage:true);}
const cancel=page.getByRole('button',{name:/取消|停止/}).first(); if(await cancel.count() && await cancel.isEnabled()) await cancel.click();
await fs.writeFile(${JSON.stringify(path.join(output,'ui-state.json'))},JSON.stringify({url:page.url(),video:await video.count(),text:(await body.innerText()).slice(0,2000)},null,2)); await browser.close();`
  const cdpOutput = await child(port, script)
  if (errors.length) throw new Error(`console errors: ${errors.join('; ')}`)
  await fs.writeFile(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2))
  console.log(JSON.stringify({ result: 'HYPERFRAMES_UI_PASSED', output, cdp: cdpOutput.trim() }))
  window.destroy(); app.quit()
} catch (error) { console.error(error.stack || error); window?.destroy(); app.exitCode = 1; app.quit() }
