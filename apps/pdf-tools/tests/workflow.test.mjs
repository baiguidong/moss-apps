import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { validate,execute } from '../src/backend/engine.mjs'
import { pdfWorkflow } from '../src/backend/workflow.mjs'

test('PDF tasks reuse actual page images, return page citations and retain review across reopen',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-pdf-workflow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const id=randomUUID(),outputDir=path.join(root,id);await fs.mkdir(outputDir)
 const result=await execute({files:[],outputDir,signal:new AbortController().signal,progress(){},input:validate({title:'付款约定',options:{mode:'create',content:'验收后三十日内付款。'}},[])})
 const files=result.files.map(file=>({...file,id:randomUUID(),name:path.basename(file.path)})),task={id,input:{},title:'付款约定',outputs:files.map(f=>f.id),status:'succeeded'}
 const service={root,state:{files,tasks:[task]},filePath:async f=>f.path},workflow=pdfWorkflow(service)
 const shown=await workflow.get(id);assert.equal(shown.result.visualReview.status,'rendered');assert.equal(shown.result.quality.state,'pending')
 const inspected=await workflow.invoke('creation.inspect',{id,page:1});assert.match(inspected.units[0].text,/三十日/);assert.match(inspected.units[0].citation.uri,/#page=1/)
 const ready=await workflow.invoke('creation.verify',{id});assert.equal(ready.pages.length,1)
 await workflow.invoke('creation.verify',{id,sourceSha256:ready.sourceSha256,pages:[{page:1,observations:'测试状态持久化；不代表真实模型视觉检查',issues:[]}]})
 assert.equal((await pdfWorkflow({...service}).get(id)).result.quality.state,'reviewed')
})

test('real 105-page PDF supports page 101+, persistent batches and review only after every page',async t=>{
 const {PDFDocument}=await import('pdf-lib')
 const {renderOfficeFile}=await import('@moss/creation-apps/office-render')
 const {registerWorkflow,finishInspection}=await import('@moss/creation-apps/workflow')
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-large-pdf-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const file=path.join(root,'large.pdf'),pdf=await PDFDocument.create();for(let i=1;i<=105;i++)pdf.addPage([160,120]).drawText('Page '+i,{x:15,y:50,size:14});await fs.writeFile(file,await pdf.save())
 const render=await renderOfficeFile(file,path.join(root,'office-preview'),{maxPages:2});assert.equal(render.result.pageCount,105);assert.equal(render.result.pages.length,2)
 const id=randomUUID(),task={id,status:'succeeded',artifacts:[{name:'large.pdf',path:file,kind:'pdf'},...render.files],result:{resourceUri:'moss-pdf://files/large',visualReview:render.result}}
 await finishInspection(task,{}, {directory:root,pdfText:async()=>Array.from({length:105},(_,i)=>'Page '+(i+1))},null,'moss-pdf',task.result.resourceUri)
 const actions=new Map();registerWorkflow({registerAction:(n,f)=>actions.set(n,f)},{get:async()=>task,directory:()=>root,write:async value=>fs.writeFile(path.join(root,'task.json'),JSON.stringify(value))},'moss-pdf')
 const verify=actions.get('creation.verify'),initial=await verify({id});assert.equal(initial.nextRender.render.startPage,3)
 const tail=await verify({id,sourceSha256:initial.sourceSha256,render:{startPage:101,count:5}});assert.equal(tail.pages.at(-1).page,105);assert.equal(tail.nextRender.render.startPage,3)
 assert.deepEqual([...await fs.readFile(tail.pages.at(-1).path)].slice(0,8),[137,80,78,71,13,10,26,10])
 await assert.rejects(verify({id,sourceSha256:'wrong',render:{count:5}}),/版本/)
 const partial=await verify({id,sourceSha256:initial.sourceSha256,pages:[{page:105,observations:'测试夹具记录：检查尾页状态，非模型视觉结论',issues:[]}]});assert.equal(partial.quality.state,'pending')
 const badPage=await verify({id,sourceSha256:initial.sourceSha256,render:{startPage:1000}}).then(()=>null,e=>e);assert.match(badPage.message,/超出/)
 assert.equal(task.result.quality.reviewedPages,1)
})
