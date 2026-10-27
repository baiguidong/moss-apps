// Run with Electron after `bun x vite build`. Uses a fake Host and no desktop input.
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const appRoot = fileURLToPath(new URL('../', import.meta.url))
const temporary = mkdtempSync(path.join(os.tmpdir(), 'moss-computer-ui-'))
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || temporary
const uiRoot = process.argv.find(arg => arg.startsWith('--ui='))?.slice(5) || path.join(appRoot, 'dist/ui')
app.setPath('userData', path.join(temporary, 'user-data'))
app.commandLine.appendSwitch('disable-gpu')
let window
const timeout = setTimeout(() => { console.error('UI verification timed out'); app.exit(1) }, 30000)
void (async () => { try {
  await app.whenReady()
  await fs.mkdir(output, { recursive: true })
  nativeTheme.themeSource = 'dark'
  let appearance = { themeMode: 'light', cssThemeId: 'grid-theme' }
  let rejectNative = false
  const requests = []
  let status = { enabled: false, supported: true, phase: 'disabled', permissions: { accessibility: true, screenRecording: false }, apps: [], version: '0.34.0' }
  const preload = path.join(temporary, 'preload.cjs')
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('mossApp', {
    app:{getInfo:()=>ipcRenderer.invoke('ui-test:info')},
    host:{request:(protocol,method,input)=>ipcRenderer.invoke('ui-test:request',{protocol,method,input}),cancel:async()=>{}},
    events:{on:(name,callback)=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('app-ui:event:'+name,listener);return()=>ipcRenderer.removeListener('app-ui:event:'+name,listener)}}
  });`)
  window = new BrowserWindow({ width: 1040, height: 760, show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })
  const errors = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  ipcMain.handle('ui-test:info', () => ({ appearance }))
  ipcMain.handle('ui-test:request', (_event, {protocol, method, input}) => {
    assert.equal(protocol, 'moss.host/v1'); assert.equal(method, 'native.settings')
    requests.push(input.operation)
    if (rejectNative) return {ok:false,error:{message:'Native adapters require a trusted signature from a Host-approved native publisher'}}
    if (input.operation === 'enable') status = {...status, enabled: input.enabled, phase: input.enabled ? 'ready' : 'disabled'}
    return {ok:true,result:status}
  })
  const read = script => window.webContents.executeJavaScript(script)
  const waitFor = async script => {
    for (let i = 0; i < 100; i++) { if (await read(script)) return; await new Promise(resolve => setTimeout(resolve, 25)) }
    throw new Error(`Condition timed out: ${script}`)
  }
  const capture = async name => {
    await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await read('Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))')
    await fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG())
  }
  const change = async (themeMode, cssThemeId) => {
    appearance = {themeMode, cssThemeId}
    window.webContents.send('app-ui:event:appearance', appearance)
    await waitFor(`document.documentElement.dataset.backgroundStyle === ${JSON.stringify(cssThemeId)}`)
  }
  await window.loadFile(path.join(uiRoot, 'index.html'))
  await waitFor(`document.getElementById('phase').textContent === '控制已关闭' && document.documentElement.dataset.theme === 'light'`)
  assert.ok(requests.includes('check'), 'the first render should perform a real permission check')
  assert.equal(await read(`matchMedia('(prefers-color-scheme: dark)').matches`), true)
  const light = await read(`getComputedStyle(document.body).backgroundColor`)
  await capture('settings-light-grid')
  await read(`document.getElementById('enable').click()`)
  await waitFor(`document.getElementById('phase').textContent === '已就绪'`)
  await change('dark', 'dot-theme')
  await waitFor(`document.documentElement.dataset.theme === 'dark'`)
  assert.notEqual(await read(`getComputedStyle(document.body).backgroundColor`), light)
  await capture('settings-dark-dot')
  await change('light', 'default')
  await waitFor(`document.documentElement.dataset.theme === 'light'`)
  assert.equal(await read(`getComputedStyle(document.body).backgroundImage`), 'none')
  await capture('settings-light-default')
  await change('dark', 'gradient-theme')
  await capture('settings-dark-gradient')
  await change('system', 'grid-theme')
  nativeTheme.themeSource = 'light'
  await waitFor(`document.documentElement.dataset.theme === 'light'`)
  nativeTheme.themeSource = 'dark'
  await waitFor(`document.documentElement.dataset.theme === 'dark'`)
  await change('light', 'grid-theme')
  window.setContentSize(390, 844)
  await waitFor('innerWidth === 390')
  assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true)
  await capture('settings-narrow')
  window.setContentSize(1040, 760)
  rejectNative = true
  window.webContents.reload()
  await waitFor(`document.getElementById('phase')?.textContent === '需要受信任的安装包'`)
  assert.equal(await read(`document.getElementById('enable').disabled`), true)
  assert.equal(await read(`document.querySelector('[data-operation="request-permissions"]').disabled`), true)
  assert.equal(await read(`document.querySelector('[data-operation="check"]').disabled`), false)
  await capture('settings-signature-error')
  rejectNative = false
  await read(`document.querySelector('[data-operation="check"]').click()`)
  await waitFor(`document.getElementById('phase').textContent === '已就绪'`)
  assert.equal(await read(`document.getElementById('error').hidden`), true)
  assert.equal(await read(`document.querySelector('[data-operation="request-permissions"]').disabled`), false)
  status = { ...status, platform: 'win32', permissions: { accessibility: true, screenRecording: true } }
  await read(`document.querySelector('[data-operation="check"]').click()`)
  await waitFor(`document.getElementById('accessibility-label').textContent === 'UI Automation'`)
  assert.equal(await read(`getComputedStyle(document.getElementById('mac-settings')).display`), 'none')
  assert.equal(await read(`getComputedStyle(document.querySelector('[data-operation="request-permissions"]')).display`), 'none')
  assert.equal(await read(`document.getElementById('screen').textContent`), '可用')
  await capture('settings-windows')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({result:'COMPUTER_USE_UI_PASSED',output,checks:['Host light overrides OS dark','live appearance events','all four backgrounds','system changes','390px layout','enable action','signature error and recovery']}))
  window.destroy(); clearTimeout(timeout)
  await fs.rm(path.join(temporary, 'user-data'), {recursive:true,force:true})
  app.exit(0)
} catch (error) { console.error(error); window?.destroy(); clearTimeout(timeout); app.exit(1) } })()
