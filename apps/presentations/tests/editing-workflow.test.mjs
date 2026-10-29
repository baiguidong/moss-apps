import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fixture } from '@moss/creation-apps/testing'
import { officeZip,xml,serialize } from '@moss/creation-apps/office'
import engine from '../src/backend/engine.mjs'
const deck={title:'原始演示',slides:[{title:'保留封面',body:'第一页不能修改'},{title:'季度数据',elements:[{type:'chart',chartType:'line',x:.5,y:1.5,w:6,h:4,series:[{name:'收入',labels:['一月','二月'],values:[10,20]}]},{type:'table',x:7,y:1.5,w:5,h:2,rows:[['指标','金额'],['收入','100']]}]}]}
test('native chart/table/font edits, source citations, structured comparisons and review versions',async t=>{
 const f=await fixture(t,engine),first=await f.run(deck),before=await officeZip(first.artifacts[0].path)
 const inspect=f.actions.get('creation.inspect'),verify=f.actions.get('creation.verify')
 const objects=(await inspect({id:first.id,page:2})).units,chart=objects.find(u=>u.detail.type==='chart'),table=objects.find(u=>u.detail.type==='table'),title=objects.find(u=>u.detail.type==='text')
 assert.match(chart.citation.uri,/#page=2/)
 const second=await f.run({title:'精准修改',mode:'edit',sourcePath:first.artifacts[0].path,parentId:first.id,objectEdits:[{slide:2,objectId:chart.objectId,chartType:'bar'},{slide:2,objectId:table.objectId,tableEdits:[{row:2,column:2,text:'200'}]},{slide:2,objectId:title.objectId,fontSize:36,expectedText:'季度数据'}]})
 const after=await officeZip(second.artifacts[0].path)
 assert.equal(await after.file('ppt/slides/slide1.xml').async('string'),await before.file('ppt/slides/slide1.xml').async('string'))
 assert.match(await after.file('ppt/charts/chart1.xml').async('string'),/barChart/);assert.doesNotMatch(await after.file('ppt/charts/chart1.xml').async('string'),/lineChart/)
 for(const name of Object.keys(before.files).filter(n=>/embeddings|notesSlides|slideMasters|slideLayouts/.test(n)&&!before.files[n].dir))assert.deepEqual(await after.file(name).async('nodebuffer'),await before.file(name).async('nodebuffer'),name)
 const updated=(await inspect({id:second.id,page:2})).units
 assert.match(updated.find(u=>u.objectId===table.objectId).text,/200/)
 assert.equal(second.result.comparison.count,3)
 const comparison=await f.actions.get('composer.resolve')({uri:second.result.comparison.resourceUri});assert.equal(comparison.presentation.type,'document-comparison')
 const data=JSON.parse(await fs.readFile(comparison.path,'utf8'));assert.equal(data.before.uri,first.result.resourceUri);assert.equal(data.after.uri,second.result.resourceUri)
 const pending=await verify({id:second.id});assert.equal(pending.quality.state,'pending');assert.equal(pending.pages.length,2)
 await assert.rejects(verify({id:second.id,sourceSha256:'wrong',pages:[{page:1,observations:'检查文字',issues:[]}]}),/版本/)
 const partial=await verify({id:second.id,sourceSha256:pending.sourceSha256,pages:[{page:1,observations:'封面文字与原版一致',issues:[]}]});assert.equal(partial.quality.state,'pending');assert.equal(partial.remainingPages.length,1)
 const broken=await verify({id:second.id,sourceSha256:pending.sourceSha256,pages:[{page:2,observations:'图表标题遮挡，需调整位置',issues:[{severity:'error',message:'标题遮挡'}]}]});assert.equal(broken.quality.state,'needs-repair');assert.equal((await f.store.get(second.id)).result.visualReview.visuallyVerified,false)
 const third=await f.run({title:'修正版',mode:'edit',sourcePath:second.artifacts[0].path,parentId:second.id,objectEdits:[{slide:2,objectId:title.objectId,y:.25}]});assert.equal(third.result.quality.reviewedPages,0)
 const check=await verify({id:third.id}),passed=await verify({id:third.id,sourceSha256:check.sourceSha256,pages:check.pages.map(p=>({page:p.page,observations:'测试夹具记录：验证核验状态流转，不代表真实模型视觉判断',issues:[]}))});assert.equal(passed.quality.state,'reviewed')
 await fs.appendFile(third.artifacts[0].path,'external change');await assert.rejects(verify({id:third.id}),/文件已变化/)
})
test('logical slide order, stale targets and out-of-bounds changes fail without mutating originals',async t=>{
 const f=await fixture(t,engine),first=await f.run(deck),file=first.artifacts[0].path,zip=await officeZip(file)
 const presentation=xml(await zip.file('ppt/presentation.xml').async('string')),list=presentation.getElementsByTagName('p:sldIdLst')[0];list.insertBefore(list.lastChild,list.firstChild);zip.file('ppt/presentation.xml',serialize(presentation));await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}))
 const read=await f.run({title:'重排后读取',mode:'read',sourcePath:file}),units=(await f.actions.get('creation.inspect')({id:read.id,page:1})).units;assert.ok(units.some(u=>u.text==='季度数据'))
 const text=units.find(u=>u.text==='季度数据'),original=await fs.readFile(file)
 const bad=await f.run({title:'错误选区',mode:'edit',sourcePath:file,objectEdits:[{slide:1,objectId:text.objectId,expectedText:'不存在',text:'错误'}]},false);assert.match(bad.message,/已变化/)
 await f.run({title:'越界修改',mode:'edit',sourcePath:file,objectEdits:[{slide:1,objectId:text.objectId,x:99}]},false)
 assert.deepEqual(await fs.readFile(file),original)
})


test('native image replacement stores distinct comparison images and preserves original source',async t=>{
 const f=await fixture(t,engine)
 const a=f.root+'/a.png',b=f.root+'/b.png'
 await fs.writeFile(a,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAIAAAD4YuoOAAAAHUlEQVR4nGNQmulCU8QwasGoBaMWjFowasFQsAAADKb+EItl8DgAAAAASUVORK5CYII=','base64'))
 await fs.writeFile(b,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAIAAAD4YuoOAAAAHUlEQVR4nGMwdtlNU8QwasGoBaMWjFowasFQsAAAgrJkH0vw9RoAAAAASUVORK5CYII=','base64'))
 const first=await f.run({title:'图片',slides:[{title:'图片',elements:[{type:'image',path:a,x:1,y:2,w:5,h:3}]}]})
 const original=await fs.readFile(first.artifacts[0].path)
 const unit=(await f.actions.get('creation.inspect')({id:first.id})).units.find(u=>u.detail.type==='image')
 const second=await f.run({title:'图片修订',mode:'edit',sourcePath:first.artifacts[0].path,parentId:first.id,objectEdits:[{slide:1,objectId:unit.objectId,imagePath:b}]})
 const cmp=await f.actions.get('composer.resolve')({uri:second.result.comparison.resourceUri}),data=JSON.parse(await fs.readFile(cmp.path,'utf8'))
 assert.equal(data.count,1)
 assert.deepEqual(await fs.readFile(data.changes[0].before.detail.imagePath),await fs.readFile(a))
 assert.deepEqual(await fs.readFile(data.changes[0].after.detail.imagePath),await fs.readFile(b))
 assert.deepEqual(await fs.readFile(first.artifacts[0].path),original)
})
