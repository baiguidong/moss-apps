import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { assertAppContentLayout, assertAppWorkspaceLayout } from './app-layout-check.mjs'
const repo=fileURLToPath(new URL('..',import.meta.url)),core=process.env.MOSS_CORE_ROOT||path.resolve(repo,'../moss')
const require=createRequire(path.join(repo,'apps/code-map/package.json')),requireCore=createRequire(path.join(core,'ui/package.json'))
const {_electron:electron,expect}=require('@playwright/test'),{build}=require('vite'),{default:react}=require('@vitejs/plugin-react')
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js')
const output=path.join(repo,'artifacts/engine-apps/verification'),shell=path.join(output,'shell/index.html'),styles=path.join(output,'shell.css')
await fs.mkdir(output,{recursive:true})
await fs.writeFile(styles,[`@import ${JSON.stringify(path.join(core,'ui/src/renderer-react/globals.css'))};`,`@source ${JSON.stringify(path.join(core,'ui/src/renderer-react/components'))};`].join('\n'))
await build({configFile:false,root:path.join(repo,'scripts/local-tasks-verify'),base:'./',plugins:[react()],logLevel:'warn',resolve:{dedupe:['react','react-dom'],alias:{react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json')),'@':path.join(core,'ui/src/renderer-react'),'moss-core-embedded-view':path.join(core,'ui/src/renderer-react/components/embedded-app-view.tsx'),'moss-core-global-style':styles}},css:{postcss:{plugins:[requireCore('@tailwindcss/postcss')()]}},build:{outDir:path.dirname(shell),emptyOutDir:true}})
const fixtures=path.join(output,'fixtures'),scans=path.join(fixtures,"扫描 中文 '[]$;&"),document=path.join(fixtures,"-输入 中文 '[]$;&.md")
const repository=path.join(fixtures,'code sample');await fs.mkdir(repository,{recursive:true});await fs.writeFile(path.join(repository,'math.ts'),'export function add(a: number, b: number) { return a + b; }\nexport function total() { return add(2, 3); }\n')
await fs.writeFile(document, '# 中文标题\n\n| 项目 | 数值 |\n| --- | ---: |\n| 示例 | 128 |\n')
await fs.writeFile(path.join(fixtures,'invalid.docx'), 'invalid document')
process.env.PW_CHROMIUM_ATTACH_TO_OTHER='1'
const names=process.argv.includes('--app')?[process.argv[process.argv.indexOf('--app')+1].replace(/^moss\./,'')]:['file-cleaner','document-converter','code-map']
for(const name of names){
 const id=`moss.${name}`,checks=[],errors=[],report=path.join(output,name);await fs.mkdir(report,{recursive:true})
 const manifest=JSON.parse(await fs.readFile(path.join(repo,'apps',name,'app.moss.json'),'utf8'))
 const desktop=await electron.launch({executablePath:path.join(core,'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[path.join(repo,'scripts/engine-apps-verify/desktop.cjs')],env:{...process.env,MOSS_CORE_ROOT:core,MOSS_TEST_APP:id,MOSS_TEST_VERSION:manifest.version,MOSS_TEST_NODE:process.execPath,MOSS_TEST_SHELL:shell,MOSS_TEST_ARCHIVE:process.env.MOSS_TEST_ARCHIVE||path.join(repo,'artifacts',id,manifest.version,`${id}-${manifest.version}-darwin-arm64.zip`),MOSS_TEST_APP_UI_SCHEME:'1'},timeout:60000})
 let page,agent,directory
 const passed=text=>{checks.push(text);console.log(`PASS ${name}: ${text}`)}
 try{
  const shellPage=await desktop.firstWindow();await expect(shellPage.locator('webview')).toBeVisible({timeout:30000})
  const isApp=p=>p.url().startsWith('moss-app://');page=desktop.context().pages().find(isApp)||await desktop.context().waitForEvent('page',{predicate:isApp,timeout:30000})
  page.setDefaultTimeout(15000)
  directory=await desktop.evaluate(()=>globalThis.localTaskFixture.directory)
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error(name,m.text().slice(0,500))})
  const invoke=(action,input={})=>desktop.evaluate((_e,args)=>globalThis.localTaskFixture.invoke(...args),[action,input])
  const click=async locator=>{await expect(locator).toBeVisible();await expect(locator).toBeEnabled();await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();await desktop.evaluate((_e,p)=>globalThis.localTaskFixture.click(p),{x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)})}
  const pick=values=>desktop.evaluate((_e,paths)=>globalThis.localTaskFixture.pick(paths),values)
  const enter=async(locator,text)=>{await locator.focus();await locator.evaluate(el=>el.select());await desktop.evaluate((_e,text)=>globalThis.localTaskFixture.insertText(text),text);await expect(locator).toHaveValue(text)}
  const waitTask=async(status='succeeded',tool)=>{let task;await expect.poll(async()=>{task=(await invoke('workspace.get')).tasks.find(t=>!tool||t.input.tool===tool);return task?.status},{timeout:180000,intervals:[300,600,1000]}).toBe(status);return task}
  const screenshot=async suffix=>{await shellPage.mouse.move(1,1);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);await fs.writeFile(path.join(report,suffix+'.png'),Buffer.from(await desktop.evaluate(()=>globalThis.localTaskFixture.screenshot()),'base64'))}
  await expect(page.locator('main')).toBeVisible({timeout:60000});await expect(page.getByRole('button',{name:'检查引擎'})).toBeEnabled({timeout:60000})
  if(process.env.MOSS_TEST_DISCOVERY_GATE){
   await expect(page.getByRole('button',{name:/全部 MCP 工具/})).toContainText('17',{timeout:60000})
   await desktop.evaluate(()=>globalThis.localTaskFixture.releaseDiscovery())
  }
  assert.equal(await page.locator('header.app-header').count(),0)
  await assertAppContentLayout(page,manifest)
  await assertAppWorkspaceLayout(page)
  await expect(shellPage.getByText(manifest.displayName,{exact:true})).toHaveCount(1)
  await expect(shellPage.getByText(manifest.description,{exact:true})).toHaveCount(1)
  const mainBox=await page.locator('main').boundingBox();assert(mainBox.y<=20,'Primary work should begin near the top')
  const capability = shellPage.getByRole('button',{name:name==='code-map'?/查看 AI 能力：17 个 AI 工具/:/查看 AI 能力：1 个 CLI skill/})
  await expect(capability).toBeVisible({timeout:60000});await capability.click()
  await expect(shellPage.locator('[data-app-capabilities]')).toContainText(name==='code-map'?'index_repository':'CLI skill')
  await fs.writeFile(path.join(report,'capabilities.png'),Buffer.from(await desktop.evaluate(()=>globalThis.localTaskFixture.screenshot()),'base64'))
  await shellPage.keyboard.press('Escape')
  passed('Host capability menu shows actual MCP tools or CLI skills without reporting zero')
  if(name==='file-cleaner'){
   await expect(page.getByRole('navigation',{name:'清理类别'}).getByRole('button')).toHaveCount(14)
   const hidden=await desktop.evaluate(()=>globalThis.localTaskFixture.skills(false));assert.equal(hidden.skills.length,0)
   const skills=await desktop.evaluate(()=>globalThis.localTaskFixture.skills(true));assert.equal(skills.skills.length,1)
   await pick([scans]);await click(page.getByRole('button',{name:'选择目录',exact:true}))
   await enter(page.getByLabel('线程数',{exact:true}),'bad-number');await click(page.getByRole('button',{name:'开始扫描',exact:true}))
   const failed=await waitTask('failed');assert.match(failed.message,/thread|invalid|error/i)
   const request=path.join(directory,'repair.json');await fs.writeFile(request,JSON.stringify({...failed.input,options:{...failed.input.options,'thread-number':'2'}}))
   const skill=skills.skills[0],repaired=JSON.parse(execFileSync(process.execPath,[skill.cliPath,'--data-dir',skill.dataDir,'run','--input-file',request],{encoding:'utf8',timeout:60000}))
   assert.equal(repaired.status,'succeeded');await expect.poll(async()=>(await invoke('workspace.get')).tasks.some(t=>t.id===repaired.id)).toBe(true)
   await expect(page.locator('.task-row').first()).toContainText('Agent skill');await click(page.locator('.task-row').first().locator('.task-title'));await expect(page.locator('.stats')).toContainText('匹配文件')
   passed('14 command forms available; failing UI task repaired by discovered CLI skill; shared results visible')
   await click(page.getByRole('button',{name:'相似图片',exact:true}));await enter(page.getByLabel('最小文件（字节）',{exact:true}),'1');await click(page.getByRole('button',{name:'开始扫描',exact:true}));await waitTask();await expect(page.locator('.file-result img').first()).toBeVisible()
   await expect.poll(()=>page.locator('.file-result img').first().evaluate(el=>el.naturalWidth)).toBeGreaterThan(100)
   passed('Real similar-image scan renders original images inside Moss')
  }else if(name==='document-converter'){
   const skills=await desktop.evaluate(()=>globalThis.localTaskFixture.skills(true));assert.equal(skills.skills.length,1)
   await pick([document]);await click(page.getByRole('button',{name:'选择文件',exact:true}));await page.getByLabel('输出格式',{exact:true}).selectOption('docx');await click(page.getByRole('button',{name:'转换文档',exact:true}));const task=await waitTask()
   const preview=page.frameLocator('iframe[title="文档内容预览"]');await expect(preview.locator('body')).toContainText('中文标题');await expect(preview.locator('table')).toContainText('128')
   const exports=path.join(directory,'exports');await fs.mkdir(exports);await pick([exports]);await click(page.getByRole('button',{name:'导出结果',exact:true}));await expect(page.getByRole('status')).toContainText('已导出');assert((await fs.readdir(exports)).some(file=>file.endsWith('.docx')))
   const skill=skills.skills[0],request=path.join(directory,'agent-convert.json');await fs.writeFile(request,JSON.stringify({...task.input,to:'html5'}))
   assert.equal(await page.evaluate(()=>document.hidden),false,'App page must remain visible during the Agent CLI task')
   const result=JSON.parse(execFileSync(process.execPath,[skill.cliPath,'--data-dir',skill.dataDir,'run','--input-file',request],{encoding:'utf8',timeout:60000}));assert.equal(result.status,'succeeded')
   await expect(page.locator('.task-row').first()).toContainText('Agent skill',{timeout:25000})
   await click(page.locator('.task-row').first().locator('.task-title'))
   await expect(page.locator('.result-panel')).toContainText('已完成')
   passed('UI conversion, real DOCX readback preview, DOCX export and independent Agent CLI result appears in the visible page')
   await page.getByLabel('输出格式',{exact:true}).selectOption('pdf');await click(page.getByRole('button',{name:'转换文档',exact:true}))
   let pdfTask;await expect.poll(async()=>{pdfTask=(await invoke('workspace.get')).tasks.find(task=>task.input.to==='pdf'&&task.source==='ui');return pdfTask?.status},{timeout:180000}).toBe('succeeded')
   assert(pdfTask.artifacts.some(file=>file.kind==='pdf'))
   const pdfFrame=page.locator('iframe[title="PDF 预览"]');await expect(pdfFrame).toBeVisible({timeout:30000})
   const pdfUrl=await pdfFrame.getAttribute('src');assert.match(pdfUrl||'',/^http:\/\/127\.0\.0\.1:\d+\//)
   await expect.poll(()=>page.frames().some(frame=>frame.url()===pdfUrl),{timeout:15000}).toBe(true)
   passed('PDF conversion opens a signed artifact in the embedded browser preview')
   await pick([path.join(fixtures,'invalid.docx')]);await click(page.getByRole('button',{name:'选择文件',exact:true}));await page.getByLabel('输出格式',{exact:true}).selectOption('html5');await click(page.getByRole('button',{name:'转换文档',exact:true}));await waitTask('partial');await expect(page.locator('.batch-files')).toContainText('失败 · invalid.docx');await expect(page.locator('.batch-files')).toContainText('已完成');await expect(preview.locator('body')).toContainText('128');passed('Mixed-input UI batch reports individual failure and preserves successful preview')
  }else{
   await expect(page.getByRole('button',{name:/全部 MCP 工具/})).toContainText('17',{timeout:60000})
   await pick([repository]);await click(page.getByRole('button',{name:'选择目录',exact:true}));await click(page.getByRole('button',{name:'建立 / 更新索引',exact:true}));const indexed=await waitTask('succeeded','index_repository');assert(indexed.result.nodes>0)
   await expect(page.getByLabel('已索引项目')).not.toHaveValue('');await click(page.getByRole('button',{name:'搜索',exact:true}));await waitTask('succeeded','search_graph')
   await click(page.locator('.symbol-list button').filter({hasText:/^total/}));await expect(page.getByRole('img',{name:'函数调用关系图'})).toBeVisible({timeout:60000});await expect(page.locator('.source-code')).toContainText('return add',{timeout:60000})
   assert.equal(Object.keys(await desktop.evaluate(()=>globalThis.localTaskFixture.servers(false))).length,0)
   const servers=await desktop.evaluate(()=>globalThis.localTaskFixture.servers(true));assert.equal(Object.keys(servers).length,1)
   const config=Object.values(servers)[0];agent=new Client({name:'moss-agent-verification',version:'0.1.0'})
   await agent.connect(new StdioClientTransport({...config,env:{...process.env,...config.env},stderr:'pipe'}))
   assert.equal((await agent.listTools()).tools.length,17)
   const result=await agent.callTool({name:'get_architecture',arguments:{project:indexed.result.project,format:'json',aspects:['file_tree','overview']}});assert(!result.isError)
   await expect.poll(async()=>(await invoke('workspace.get')).tasks.some(t=>t.source==='agent-tool'&&t.input.tool==='get_architecture'&&t.status==='succeeded')).toBe(true)
   await agent.close();agent=null
   passed('UI indexes and reads source/call graph; registered MCP exposes 17 tools only when selected; Agent results appear in UI')
  }
  await screenshot('light');await desktop.evaluate(()=>globalThis.localTaskFixture.theme('dark'));await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await screenshot('dark')
  await desktop.evaluate(()=>globalThis.localTaskFixture.resize({width:440,height:900}));await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await screenshot('narrow')
  await desktop.evaluate(()=>globalThis.localTaskFixture.resize({width:1180,height:880}))
  const before=await invoke('workspace.get');await desktop.evaluate(()=>globalThis.localTaskFixture.restart());await desktop.evaluate(()=>globalThis.localTaskFixture.reload());await expect(page.locator('main')).toBeVisible({timeout:30000});await expect.poll(async()=>{try{return (await invoke('workspace.get')).tasks.length}catch(error){if(/context was destroyed/.test(error.message))return -1;throw error}},{timeout:60000}).toBe(before.tasks.length)
  if(name==='document-converter')await expect(page.frameLocator('iframe[title="文档内容预览"]').locator('body')).toContainText('128',{timeout:30000})
  await desktop.evaluate(()=>globalThis.localTaskFixture.enabled(false));assert.equal((await desktop.evaluate(()=>globalThis.localTaskFixture.skills(true))).skills.length,0);assert.equal(Object.keys(await desktop.evaluate(()=>globalThis.localTaskFixture.servers(true))).length,0)
  passed('Moss light/dark/narrow UI, restart persistence and disabling Agent discovery verified')
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(report,'report.json'),JSON.stringify({appId:id,checks,pageErrors:errors},null,2)+'\n')
 }catch(error){console.error('MCP catalog:',await desktop.evaluate(()=>globalThis.localTaskFixture.catalog()).catch(()=>[]));if(page){console.error(await page.locator('body').innerText().catch(()=>''));await fs.writeFile(path.join(report,'failure.png'),Buffer.from(await desktop.evaluate(()=>globalThis.localTaskFixture.screenshot()).catch(()=>''),'base64'))}throw error}
 finally{await agent?.close().catch(()=>{});await desktop.evaluate(()=>globalThis.localTaskFixture.cleanup()).catch(()=>{});await desktop.close();if(directory)await fs.rm(directory,{recursive:true,force:true})}
}
