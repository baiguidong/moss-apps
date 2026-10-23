// Real Excel MCP discovery in the production EmbeddedAppView, with an isolated App profile.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {assertAppContentLayout,assertAppWorkspaceLayout} from './app-layout-check.mjs'
const repo=fileURLToPath(new URL('..',import.meta.url)),core=process.env.MOSS_CORE_ROOT||path.resolve(repo,'../moss')
const require=createRequire(path.join(repo,'apps/image-tools/package.json')),requireCore=createRequire(path.join(core,'ui/package.json'))
const {_electron:electron,expect}=require('@playwright/test'),{build}=require('vite'),{default:react}=require('@vitejs/plugin-react')
const output=path.join(repo,'artifacts/app-capabilities'),shell=path.join(output,'shell/index.html'),styles=path.join(output,'shell.css')
await fs.mkdir(output,{recursive:true})
await fs.writeFile(styles,[`@import ${JSON.stringify(path.join(core,'ui/src/renderer-react/globals.css'))};`,`@source ${JSON.stringify(path.join(core,'ui/src/renderer-react/components'))};`].join('\n'))
await build({configFile:false,root:path.join(repo,'scripts/local-tasks-verify'),base:'./',plugins:[react()],logLevel:'warn',resolve:{dedupe:['react','react-dom'],alias:{react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json')),'@':path.join(core,'ui/src/renderer-react'),'moss-core-embedded-view':path.join(core,'ui/src/renderer-react/components/embedded-app-view.tsx'),'moss-core-global-style':styles}},css:{postcss:{plugins:[requireCore('@tailwindcss/postcss')()]}},build:{outDir:path.dirname(shell),emptyOutDir:true}})
const definition=JSON.parse(await fs.readFile(path.join(repo,'tool-apps/excel/app.json')))
const {MANAGED_RUNTIME_VERSIONS}=await import(path.join(core,'ui/src/runtime/runtime-manifest.mjs'))
const python=process.env.MOSS_PYTHON_PATH||path.join(os.homedir(),'.moss/runtimes/python/versions',MANAGED_RUNTIME_VERSIONS.python,'bin/python3')
process.env.PW_CHROMIUM_ATTACH_TO_OTHER='1'
const desktop=await electron.launch({executablePath:path.join(core,'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[path.join(repo,'scripts/engine-apps-verify/desktop.cjs')],env:{...process.env,MOSS_CORE_ROOT:core,MOSS_TEST_APP:definition.id,MOSS_TEST_VERSION:definition.version,MOSS_TEST_NODE:process.execPath,MOSS_TEST_SHELL:shell,MOSS_TEST_DISCOVERY_GATE:'1',MOSS_PYTHON_PATH:python,MOSS_MCP_PYTHON_HOME:process.env.MOSS_MCP_PYTHON_HOME||path.join(os.homedir(),'.moss/mcp/python'),MOSS_TEST_ARCHIVE:path.join(repo,'artifacts',definition.id,definition.version,`${definition.id}-${definition.version}.zip`)},timeout:60000})
let directory,page
try{
 page=await desktop.firstWindow()
 directory=await desktop.evaluate(()=>globalThis.localTaskFixture.directory)
 await expect(page.getByRole('button',{name:'查看 AI 能力：AI 能力'})).toBeVisible({timeout:30000})
 // A parent catalog refresh during discovery must not discard the pending response.
 await desktop.evaluate(()=>globalThis.localTaskFixture.notifyCatalog())
 await page.waitForTimeout(150)
 await desktop.evaluate(()=>globalThis.localTaskFixture.releaseDiscovery())
 const button=page.getByRole('button',{name:'查看 AI 能力：42 个 AI 工具'})
 await expect(button).toBeVisible({timeout:300000})
 const catalog=await desktop.evaluate(()=>globalThis.localTaskFixture.catalog())
 assert.equal(catalog[0].status,'connected');assert.equal(catalog[0].tools.length,42)
 await button.click()
 const details=page.locator('[data-app-capabilities]')
 await expect(details).toContainText('create_workbook');await expect(details).toContainText('read_range')
 await expect(details.locator('tbody tr')).toHaveCount(42)
 await expect(details).not.toContainText('未向 AI 助手提供工具')
 await page.screenshot({path:path.join(output,'excel-tools.png')})
 await page.keyboard.press('Escape')
 // A new Host and renderer must restore metadata without starting another MCP process.
 const inspections=await desktop.evaluate(()=>globalThis.localTaskFixture.inspections())
 await desktop.evaluate(()=>globalThis.localTaskFixture.restartCatalog())
 await page.reload()
 await expect(button).toBeVisible()
 const cached=await desktop.evaluate(()=>globalThis.localTaskFixture.catalog())
 assert.equal(cached[0].status,'unchecked');assert.equal(cached[0].catalogSource,'cache');assert.equal(cached[0].tools.length,42)
 await button.click()
 await expect(details).toContainText('显示上次获取的工具清单')
 await expect(details.locator('tbody tr')).toHaveCount(42)
 await page.waitForTimeout(500)
 assert.equal(await desktop.evaluate(()=>globalThis.localTaskFixture.inspections()),inspections)
 await page.screenshot({path:path.join(output,'excel-cached-tools.png')})
 await details.getByRole('button',{name:/重新加载 .* 工具/}).click()
 await expect(details.locator('tbody tr')).toHaveCount(42)
 await expect(details).not.toContainText('显示上次获取的工具清单',{timeout:300000})
 assert.equal(await desktop.evaluate(()=>globalThis.localTaskFixture.inspections()),inspections+1)
 await page.keyboard.press('Escape')
 // The shared MCP page uses the available space and keeps settings with status/check.
 const guest=desktop.context().pages().filter(page=>page.url().includes('/mcp-app/index.html')).at(-1)
 assert(guest,'Expected the production MCP page')
 await expect(guest.locator('#settings')).toBeEnabled()
 for(const [name,width,height] of [['normal',1180,880],['narrow',720,600],['small',380,700]]){
  await desktop.evaluate((_e,size)=>globalThis.localTaskFixture.resize(size),{width,height})
  await expect(guest.getByRole('button',{name:'连接设置',exact:true})).toBeVisible()
  await assertAppContentLayout(guest,{displayName:definition.displayName,description:definition.description})
  await assertAppWorkspaceLayout(guest)
  const settings=await guest.locator('#settings').boundingBox(),inspect=await guest.locator('#inspect').boundingBox()
  assert(Math.abs(settings.y-inspect.y)<2,'Settings and service check must share the toolbar')
  await expect(guest.locator('.service-guides')).toBeInViewport()
  for(const mode of ['light','dark']){
   await desktop.evaluate((_e,mode)=>globalThis.localTaskFixture.theme(mode),mode)
   await expect(guest.locator('html')).toHaveAttribute('data-theme',mode)
   await page.evaluate(mode=>{document.documentElement.dataset.theme=mode},mode)
   await page.screenshot({path:path.join(output,`compact-excel-${name}-${mode}.png`)})
  }
 }
 await desktop.evaluate(()=>globalThis.localTaskFixture.enabled(false))
 await page.getByRole('button',{name:'查看 AI 能力：42 个 AI 工具 · 服务已停用'}).click();await expect(details).toContainText('App 已停用')
 await page.keyboard.press('Escape')
 await desktop.evaluate(()=>globalThis.localTaskFixture.enabled(true))
 await expect(button).toBeVisible()
 const report={appId:definition.id,version:definition.version,tools:42,checks:['Unknown MCP displays neutral AI capabilities','Production Host discovers the real Excel server through strict IPC','Parent refresh during discovery preserves the result','Header and details show all 42 tools','Restarted Host and renderer restore cached metadata without probing','Manual refresh preserves rows and replaces the cached catalog','Compact production MCP layout at normal, narrow and small widths in both themes','Settings and service check share the content toolbar','Enable/disable events refresh availability'],checkedAt:new Date().toISOString()}
 await fs.writeFile(path.join(output,'excel.json'),JSON.stringify(report,null,2)+'\n')
 console.log('PASS Excel: real 42-tool discovery, neutral state, restart cache without probes, manual refresh, compact responsive layout, themes and availability')
}catch(error){
 console.error(await page?.locator('body').innerText().catch(()=>''))
 if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})
 throw error
}finally{
 await desktop.evaluate(()=>globalThis.localTaskFixture.cleanup()).catch(()=>{});await desktop.close()
 if(directory)await fs.rm(directory,{recursive:true,force:true})
}
