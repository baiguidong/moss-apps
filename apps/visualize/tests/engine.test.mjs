import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import engine, { parseCsv, validate } from '../src/backend/engine.mjs'
import { TaskStore, executeTask } from '@moss/engine-apps/runtime'
import { composerActions } from '../src/backend/composer.mjs'

test('CSV handles quotes/newlines and rejects missing, nonfinite and malformed values',()=>{
  assert.deepEqual(parseCsv('名称,金额\r\n"含,逗号",-12\r\n"两\n行",5').rows,[['含,逗号',-12],['两\n行',5]])
  for(const csv of ['名,值\na,','名,值\na,Infinity','名,值\n"a,2','名,名\na,2'])assert.throws(()=>parseCsv(csv))
  assert.throws(()=>validate({title:'占比',type:'pie',csv:'名,值\na,-2'}),/非负/)
})
test('revisions preserve original files and require an existing successful parent',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-visualize-versions-'))
  try {
    const store=new TaskStore(root)
    const first=await executeTask(engine,store,await store.create({title:'第一版',mode:'html',html:'<p>original</p>'}))
    assert.equal(first.status,'succeeded')
    const original=await fs.readFile(first.artifacts[0].path,'utf8')
    const revised=await executeTask(engine,store,await store.create({title:'第二版',mode:'html',html:'<p>revised</p>',parentId:first.id}))
    assert.equal(revised.status,'succeeded');assert.equal(revised.result.version,2);assert.equal(revised.result.workId,first.id)
    assert.notEqual(first.result.resourceUri,revised.result.resourceUri)
    assert.equal(await fs.readFile(first.artifacts[0].path,'utf8'),original)
    const actions=composerActions(root),resolved=await actions.resolve({uri:revised.result.resourceUri})
    assert.equal(resolved.presentation.type,'interactive-html');assert.equal(resolved.version,2)
    const context=await actions.resolve({intent:'edit',ref:{taskId:first.id}})
    assert.equal(context.ref.taskId,first.id);assert.equal(context.route,undefined)
    assert.ok(context.tools.includes('visualize_create'))
    const invalid=await executeTask(engine,store,await store.create({title:'无原版',mode:'html',html:'<p>missing</p>',parentId:'00000000-0000-0000-0000-000000000000'}))
    assert.equal(invalid.status,'failed')
    await assert.rejects(actions.resolve({uri:'moss-visualize://works/'+invalid.id}))
    await assert.rejects(actions.resolve({uri:revised.result.resourceUri+'?path=elsewhere'}))
    const foreign=path.join(root,'foreign.html');await fs.writeFile(foreign,'outside task')
    await fs.rm(revised.artifacts[0].path);await fs.symlink(foreign,revised.artifacts[0].path)
    await assert.rejects(actions.resolve({uri:revised.result.resourceUri}),/不属于/)
  } finally { await fs.rm(root,{recursive:true,force:true}) }
})
test('all chart formats produce offline escaped interactive HTML and reusable data',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-visualize-'))
  try{for(const type of ['bar','line','pie','scatter','table']){
    const directory=path.join(root,type);await fs.mkdir(directory)
    const result=await engine.execute({title:'<script>标题</script>',type,csv:type==='scatter'?'时间,数量\n2,3\n12,8':'名称,数量\n甲,3\n乙,8'},{directory,signal:new AbortController().signal,progress:async()=>{}})
    assert.equal(result.artifacts.length,5)
    const html=await fs.readFile(result.artifacts[0].path,'utf8')
    assert.match(html,/&lt;script&gt;标题/);assert.match(html,/connect-src 'none'/);assert.match(html,/addEventListener/)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'data.json'),'utf8')).rows,type==='scatter'?[['2',3],['12',8]]:[['甲',3],['乙',8]])
  }}finally{await fs.rm(root,{recursive:true,force:true})}
})
