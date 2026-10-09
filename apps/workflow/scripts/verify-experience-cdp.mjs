import {chromium} from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)),repo=path.resolve(root,'../..'),out=path.join(repo,'artifacts/moss.workflow/verification/0.1.9')
await fs.mkdir(out,{recursive:true})
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222')
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/renderer/'))
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const target=(await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json()))[0]
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}))
let sequence=0;const pending=new Map()
socket.addEventListener('message',e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(v.error):v.result.exceptionDetails?p.reject(new Error(JSON.stringify(v.result.exceptionDetails))):p.resolve(v.result.result?.value)}})
const main=expression=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expression.replaceAll("process.cwd()+'/src/main.mjs'",JSON.stringify(path.resolve(repo,'../moss/ui/src/main.mjs'))),awaitPromise:true,returnByValue:true}}))})
async function inspectFlow() {
 const target=await wait(async()=>{const targets=await fetch('http://127.0.0.1:9222/json/list').then(r=>r.json());return targets.find(t=>t.type==='webview'&&t.url.includes('/flow/'))})
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
 const result=await new Promise((resolve,reject)=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){m.error?reject(new Error(m.error.message)):resolve(m.result.result?.value)}});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'({nodes:document.querySelectorAll(".react-flow__node").length,transform:document.querySelector(".react-flow__viewport")?.style.transform,text:document.body.innerText})',returnByValue:true}}))})
 ws.close();return result
}
const wait=async(fn,ms=90000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,250))}throw new Error('Timed out')}
const receipt={tests:[],fixtureIds:[],sessionIds:[],runIds:[]}
let appPage
try {
 if(process.env.SKIP_INSTALL!=='1'){
  const zip=path.join(repo,'artifacts/moss.workflow/0.1.9/moss.workflow-0.1.9.zip')
  await main(`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd()+'/src/main.mjs')('electron')).then(({dialog})=>{globalThis.__experienceDialogs={open:dialog.showOpenDialog,message:dialog.showMessageBox};dialog.showOpenDialog=async(...a)=>a.at(-1)?.title==='Install Moss App'?{canceled:false,filePaths:[${JSON.stringify(zip)}]}:globalThis.__experienceDialogs.open(...a);dialog.showMessageBox=async(...a)=>a.at(-1)?.title==='安装 Moss App'&&a.at(-1)?.message?.includes('工作流')?{response:1,checkboxChecked:false}:globalThis.__experienceDialogs.message(...a);return true})`)
  const installation=await page.evaluate(()=>window.agentDesktop.installAppArchive());assert.equal(installation.ok,true,installation.error)
  await main("Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd()+'/src/main.mjs')('electron')).then(({dialog})=>{dialog.showOpenDialog=globalThis.__experienceDialogs.open;dialog.showMessageBox=globalThis.__experienceDialogs.message;delete globalThis.__experienceDialogs;return true})")
  receipt.tests.push('installed actual 0.1.9 ZIP')
 }
 assert.equal((await page.evaluate(()=>window.agentDesktop.launchApp({name:'moss.workflow'}))).ok,true)
 appPage=await wait(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p!==page&&p.url().startsWith('moss-app:')))
 appPage.on('pageerror',e=>errors.push(e.message))
 await appPage.getByRole('button',{name:'在会话中创建',exact:true}).first().waitFor()
 const invoke=(name,input={})=>appPage.evaluate(async({name,input})=>{const instances=await window.mossApp.instances.list();return window.mossApp.actions.invoke(instances[0].id,name,input)},{name,input})
 await page.getByRole('button',{name:'新会话',exact:true}).click()
 const before=await page.evaluate(()=>window.agentDesktop.listSessions())
 await appPage.getByRole('button',{name:'在会话中创建',exact:true}).first().click()
 await page.getByRole('textbox').filter({visible:true}).first().waitFor()
 assert.equal((await page.evaluate(()=>window.agentDesktop.listSessions())).length,before.length)
 assert.ok((await page.locator('textarea').inputValue()).includes('创建一个工作流'))
 assert.equal(await appPage.locator('textarea').count(),0)
 const text=await appPage.locator('body').innerText();for(const label of ['迁移历史','深度研究','新建普通会话并运行','新建会话并测试','设计流程 · 调度执行 · 追踪结果'])assert.ok(!text.includes(label),label)
 receipt.tests.push('App creates an ordinary unsent draft without an empty session; removed legacy/manual UI')
 const stamp=Date.now(),definition={version:3,kind:'state-machine',meta:{name:'experience-'+stamp,title:'测试 · 会话流程 '+stamp,description:'输入数量，计算两倍'},graph:{entry:'start',nodes:[{id:'start',type:'start',title:'输入数量',outputSchema:{type:'object',properties:{quantity:{type:'number',title:'数量',description:'需要计算的数量'}},required:['quantity'],additionalProperties:false}}],edges:[]}}
 let prev='start';for(let i=0;i<12;i++){const id='step'+i;definition.graph.nodes.push({id,type:'code',title:i===11?'数量翻倍':'计算阶段 '+(i+1),language:'javascript',input:[{target:[],source:i===0?{kind:'workflow-input',path:['quantity']}:{kind:'node-output',nodeId:prev}}],outputSchema:{type:'number'},script:i===11?'return input * 2':'return input'});definition.graph.edges.push({source:prev,target:id});prev=id}
 definition.graph.nodes.push({id:'end',type:'end',title:'结果',inputSchema:{},input:[{target:[],source:{kind:'node-output',nodeId:prev}}]});definition.graph.edges.push({source:prev,target:'end'})
 const draft=await invoke('catalog.create',{definition});receipt.fixtureIds.push(draft.record.id)
 await appPage.evaluate(id=>{location.hash='/definitions/'+id},draft.record.id)
 await appPage.getByRole('button',{name:'继续完善',exact:true}).waitFor()
 await invoke('catalog.publish',{workflowId:draft.record.id})
 await appPage.getByRole('button',{name:'使用工作流',exact:true}).waitFor()
 await appPage.getByRole('button',{name:'使用工作流',exact:true}).click()
 await wait(async()=>(await page.locator('textarea').inputValue()).includes(definition.meta.title))
 assert.equal((await page.evaluate(()=>window.agentDesktop.listSessions())).length,before.length)
 const resources=await page.evaluate(()=>window.agentDesktop.listAppResources({query:'experience-'}));assert.ok(resources.items.some(e=>e.ref.workflowId===draft.record.id))
 await page.getByLabel('移除工作流：'+definition.meta.title).click()
 await page.getByRole('button',{name:'选择资源',exact:true}).click()
 await page.getByRole('tab',{name:'工作流',exact:true}).click()
 await page.getByPlaceholder('搜索已发布工作流').fill(definition.meta.title)
 await page.getByRole('button',{name:new RegExp(definition.meta.title)}).last().click()
 await page.getByRole('button',{name:'确定',exact:true}).click()
 await page.getByLabel('移除工作流：'+definition.meta.title).waitFor()
 await page.getByLabel('移除工作流：'+definition.meta.title).click()
 await page.locator('textarea').fill('@')
 await page.getByRole('button',{name:'工作流',exact:true}).click()
 await page.locator('textarea').fill('@'+definition.meta.title.split(' ').at(-1))
 await page.getByRole('button',{name:new RegExp(definition.meta.title)}).last().click()
 await page.getByLabel('移除工作流：'+definition.meta.title).waitFor()
 receipt.tests.push('resource picker and @ select the same published resource before a session exists')
 await page.locator('textarea').fill('使用这个工作流，数量是 21，请运行。')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 const session=await wait(async()=>{const sessions=await page.evaluate(()=>window.agentDesktop.listSessions());return sessions.find(s=>!before.some(b=>b.id===s.id))});receipt.sessionIds.push(session.id)
 assert.equal(session.agentMode,'local');assert.equal(session.originChannel,'desktop')
 const run=await wait(async()=>{const runs=await invoke('run.list');return runs.find(r=>r.workflowId===draft.record.id)},180000);receipt.runIds.push(run.id)
 const completed=await wait(async()=>{const r=await invoke('run.get',{runId:run.id});return r.status==='completed'?r:r.status==='failed'?Promise.reject(new Error(r.error)):null})
 assert.equal(completed.result,42);assert.equal(completed.sessionId,session.id)
 assert.ok(completed.snapshot.nodes.length===14);assert.ok(completed.snapshot.nodes.every(n=>n.state==='completed'))
 assert.ok(completed.eventCount>10)
 assert.equal((await invoke('run.list')).filter(r=>r.workflowId===draft.record.id).length,1)
 await page.locator('[data-app-flow]').waitFor()
 assert.equal(await page.getByRole('button',{name:'查看运行详情',exact:true}).count(),0)
 await page.getByText('工作流结果',{exact:true}).waitFor()
 await page.getByLabel('收起流程',{exact:true}).click()
 await page.getByLabel('展开流程',{exact:true}).waitFor()
 await page.getByLabel('展开流程',{exact:true}).click()
 const flow=await wait(async()=>{const flow=await inspectFlow();return flow.nodes===14?flow:null});assert.equal(flow.nodes,14);assert.ok(!flow.text.includes('工作流目录'));receipt.flow=flow;
 await page.screenshot({path:path.join(out,'ordinary-flow.png'),fullPage:true})
 await appPage.screenshot({path:path.join(out,'app-catalog.png'),fullPage:true})
 receipt.tests.push('natural language quantity 21 starts exactly one ordinary-session run; result 42 and 14 completed node states; composer card removed; panel collapse/reopen')
 // Follow-up retains the result and does not run the selected workflow again.
 await wait(async()=>!(await page.evaluate(id=>window.agentDesktop.getSession({sessionId:id}),session.id)).busy)
 await page.locator('textarea').fill('刚才的结果是多少？只解释结果，不要再次运行。')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 await wait(async()=>{const d=await page.evaluate(id=>window.agentDesktop.getSession({sessionId:id}),session.id);return !d.busy && d.history.some(e=>e.type==='user' && e.prompt?.startsWith('刚才的结果'))},180000)
 assert.equal((await invoke('run.list')).filter(r=>r.workflowId===draft.record.id).length,1)
 receipt.tests.push('follow-up reads persisted result without rerunning')
 // Agent authors and edits a draft through the prepared tools in ordinary chat.
 await appPage.getByRole('button',{name:'在会话中创建',exact:true}).first().click()
 await wait(async()=>(await page.locator('textarea').inputValue()).includes('创建一个工作流'))
 const authorName='experience-agent-'+stamp
 await page.locator('textarea').fill(`创建工作流，内部名称 ${authorName}，标题“测试会话创作 ${stamp}”。开始节点输入 quantity，中文名称“数量”，类型数字；代码节点把数量加三；结束节点返回这个数字。只保存草稿，不发布、不运行。`)
 await page.getByRole('button',{name:'发送',exact:true}).click()
 const authored=await wait(async()=>{const entries=await invoke('catalog.list');return entries.find(e=>e.name===authorName)},180000);receipt.fixtureIds.push(authored.id)
 const authorSession=await wait(async()=>{const sessions=await page.evaluate(()=>window.agentDesktop.listSessions());return sessions.find(s=>!before.some(b=>b.id===s.id)&&s.id!==session.id)},30000);receipt.sessionIds.push(authorSession.id)
 await wait(async()=>!(await page.evaluate(id=>window.agentDesktop.getSession({sessionId:id}),authorSession.id)).busy,180000)
 assert.equal(authored.status,'draft');assert.equal((await invoke('run.list')).filter(r=>r.workflowId===authored.id).length,0)
 await page.locator('[data-app-flow]').waitFor()
 await appPage.evaluate(id=>{location.hash='/definitions/'+id},authored.id)
 await appPage.getByRole('button',{name:'继续完善',exact:true}).click()
 await wait(async()=>(await page.locator('textarea').inputValue()).includes('请修改'))
 await page.locator('textarea').fill('请把这个工作流中“数量加三”改成“数量加四”，其余结构保持原样。只保存修改，不发布、不运行。')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 const updated=await wait(async()=>{const d=await invoke('catalog.get',{workflowId:authored.id});return d.record.currentRevision===2?d:null},180000)
 const editSession=await wait(async()=>{const ss=await page.evaluate(()=>window.agentDesktop.listSessions());return ss.find(s=>!before.some(b=>b.id===s.id)&&!receipt.sessionIds.includes(s.id))});receipt.sessionIds.push(editSession.id)
 await wait(async()=>!(await page.evaluate(id=>window.agentDesktop.getSession({sessionId:id}),editSession.id)).busy,180000)
 assert.equal(updated.record.status,'draft');assert.equal((await invoke('run.list')).filter(r=>r.workflowId===authored.id).length,0)
 assert.ok(updated.revision.definition.graph.nodes.some(n=>n.type==='code' && n.script.includes('4')))
 receipt.tests.push('prepared Agent tools create and edit a draft in ordinary sessions with persisted flow preview; neither action publishes or runs')
 await page.screenshot({path:path.join(out,'agent-authoring.png'),fullPage:true})
 receipt.pageErrors=errors;assert.deepEqual(errors,[])
 receipt.passed=true
 console.log(JSON.stringify(receipt,null,2))
} catch(error) { receipt.error=error.stack;console.error(error);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});process.exitCode=1 }
finally {
 await fs.writeFile(path.join(out,'experience-cdp.json'),JSON.stringify({...receipt,timestamp:new Date().toISOString()},null,2))
 try{await main("Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd()+'/src/main.mjs')('electron')).then(({dialog})=>{if(globalThis.__experienceDialogs){dialog.showOpenDialog=globalThis.__experienceDialogs.open;dialog.showMessageBox=globalThis.__experienceDialogs.message;delete globalThis.__experienceDialogs}return true})")}catch{}
 socket.close();await browser.close()
}
