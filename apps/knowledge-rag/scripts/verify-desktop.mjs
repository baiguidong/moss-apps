import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const appRoot=fileURLToPath(new URL('..',import.meta.url)),repo=path.resolve(appRoot,'../..')
const core=process.env.MOSS_CORE_ROOT||path.resolve(repo,'../moss')
const output=path.join(repo,'artifacts/moss.knowledge-rag/comparison/screenshots');await fs.mkdir(output,{recursive:true})
const desktop=await electron.launch({executablePath:process.env.MOSS_TEST_ELECTRON||path.join(core,'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args:[path.join(appRoot,'scripts/desktop-fixture.cjs')],env:{...process.env,MOSS_CORE_ROOT:core,MOSS_APPS_ROOT:repo,MOSS_TEST_NODE:process.execPath,MOSS_TEST_PYTHON:process.env.MOSS_RAG_TEST_PYTHON||path.join(repo,'.cache/knowledge-rag/venv/bin/python')}})
const errors=[],checks=[]
let rag,library,temporary
try{
  await expect.poll(()=>desktop.evaluate(()=>Boolean(globalThis.ragFixture)).catch(()=>false),{timeout:60000}).toBe(true)
  temporary=await desktop.evaluate(()=>globalThis.ragFixture.temporary)
  for(const page of desktop.windows()){
    page.on('pageerror',error=>errors.push(error.message))
    if((await page.title()).includes('语义'))rag=page
    else library=page
  }
  assert.ok(rag&&library)
  await expect(rag.getByRole('button',{name:'导入文件',exact:true})).toBeEnabled({timeout:180000})
  assert.equal(await desktop.evaluate(()=>globalThis.ragFixture.scope()),'session')
  assert.deepEqual(await desktop.evaluate(()=>globalThis.ragFixture.servers([])),[])
  assert.equal((await desktop.evaluate(()=>globalThis.ragFixture.servers(['moss.knowledge-rag']))).length,1)
  await desktop.evaluate(()=>globalThis.ragFixture.setPicker())
  await rag.getByRole('button',{name:'导入文件',exact:true}).click()
  await expect(rag.getByRole('status').filter({hasText:'已复制 20 个文件'})).toBeVisible({timeout:60000})
  await expect.poll(async()=>{const result=await desktop.evaluate(()=>globalThis.ragFixture.invoke('engine.status'));return result.reindex?.active===false},{timeout:180000}).toBe(true)
  await rag.getByRole('button',{name:'刷新',exact:true}).click()
  await expect(rag.locator('.document')).toHaveCount(20,{timeout:30000})
  await expect(rag.locator('.indexing')).toHaveCount(0,{timeout:10000})
  await rag.getByRole('button',{name:'关闭提示'}).click()
  checks.push('Actual ZIP + Core Runtime, production UI request broker and preload; native picker stub; 20 real documents imported and indexed')
  const query='老用户说下一年不想再买了，我们该怎么挽留'
  await rag.getByRole('textbox',{name:'搜索资料'}).fill(query)
  await rag.getByRole('button',{name:'搜索',exact:true}).click()
  await expect(rag.locator('.document').first()).toContainText('renewal.md',{timeout:30000})
  await rag.screenshot({path:path.join(output,'rag-search.png')})
  await library.getByRole('textbox',{name:'搜索文档'}).fill(query)
  await expect(library.getByText('没有找到相关文档',{exact:true})).toBeVisible()
  await library.screenshot({path:path.join(output,'library-search.png')})
  await rag.locator('.document').first().click()
  await expect(rag.getByRole('dialog',{name:'阅读资料'})).toBeVisible()
  await expect(rag.locator('.content')).not.toBeEmpty()
  await rag.screenshot({path:path.join(output,'rag-reading.png')})
  await rag.getByRole('button',{name:'关闭阅读'}).click()
  checks.push('Same semantic question rendered in both real App UIs; search result opens actual source text')
  await rag.evaluate(()=>{location.hash='#/moss-settings'})
  await expect(rag.getByRole('radio',{name:/跟随 App 默认/})).toBeChecked()
  await rag.getByRole('radio',{name:/^全局/}).click()
  await expect(rag.getByRole('radio',{name:/^全局/})).toBeChecked()
  await expect.poll(()=>desktop.evaluate(()=>globalThis.ragFixture.scope())).toBe('global')
  assert.equal((await desktop.evaluate(()=>globalThis.ragFixture.servers([]))).length,1)
  await rag.screenshot({path:path.join(output,'rag-settings-global.png')})
  await desktop.evaluate(()=>globalThis.ragFixture.restart())
  await expect.poll(()=>desktop.evaluate(()=>globalThis.ragFixture.scope())).toBe('global')
  await expect.poll(async()=>{const result=await desktop.evaluate(()=>globalThis.ragFixture.invoke('engine.status'));return result.state},{timeout:60000}).toBe('ready')
  await rag.reload()
  await rag.evaluate(()=>{location.hash='#/moss-settings'})
  await expect(rag.getByRole('radio',{name:/^全局/})).toBeChecked()
  await rag.getByRole('radio',{name:/指定会话/}).click()
  await expect(rag.getByRole('radio',{name:/指定会话/})).toBeChecked()
  await expect.poll(()=>desktop.evaluate(()=>globalThis.ragFixture.scope())).toBe('session')
  assert.deepEqual(await desktop.evaluate(()=>globalThis.ragFixture.servers([])),[])
  assert.equal((await desktop.evaluate(()=>globalThis.ragFixture.servers(['moss.knowledge-rag']))).length,1)
  checks.push('UI changes session → global → session, MCP selection gates update; Backend restart and page reload preserve global selection')
  const catalog=await desktop.evaluate(()=>globalThis.ragFixture.inspect())
  assert.equal(catalog.tools.length,13)
  await fs.writeFile(path.join(output,'mcp-catalog.json'),JSON.stringify(catalog,null,2))
  await rag.evaluate(()=>{document.documentElement.dataset.theme='dark'})
  await rag.screenshot({path:path.join(output,'rag-settings-dark.png')})
  await desktop.evaluate(({BrowserWindow})=>{const id=globalThis.ragFixture.windowId('moss.knowledge-rag');BrowserWindow.fromId(id).setSize(760,660)})
  await expect.poll(()=>rag.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await rag.screenshot({path:path.join(output,'rag-compact.png')})
  assert.deepEqual(errors,[])
  checks.push('Light/dark/760px layouts, no horizontal overflow or renderer errors; live MCP tools catalog inspected')
  const changes=await desktop.evaluate(()=>globalThis.ragFixture.changes)
  const pid=await desktop.evaluate(async()=>(await globalThis.ragFixture.invoke('engine.status')).pid)
  await desktop.evaluate(()=>globalThis.ragFixture.cleanup())
  await expect.poll(()=>{try{process.kill(pid,0);return false}catch(error){return error.code==='ESRCH'}},{timeout:10000}).toBe(true)
  checks.push('Runtime shutdown stops the owned Python engine process')
  const packageSha256=createHash('sha256').update(await fs.readFile(path.join(repo,'artifacts/moss.knowledge-rag/0.1.1/moss.knowledge-rag-0.1.1.zip'))).digest('hex')
  await fs.writeFile(path.join(path.dirname(output),'desktop-verification.json'),JSON.stringify({at:new Date().toISOString(),packageSha256,checks,errors,scopeChanges:changes,limitations:['macOS Apple Silicon only','Native picker returns frozen test files; production runtime, backend, MCP, models, preload and renderer are real','Preinstalled test Python and shared pinned model cache avoid duplicate downloads']},null,2))
  await fs.rm(path.join(output,'failure.png'),{force:true})
  console.log(JSON.stringify({checks,output},null,2))
}catch(error){if(rag)await rag.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error}
finally{await desktop.evaluate(()=>globalThis.ragFixture?.cleanup()).catch(()=>{});await desktop.close();if(temporary)await fs.rm(temporary,{recursive:true,force:true})}
