import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fixture } from '@moss/creation-apps/testing'
import { officeZip, officeText } from '@moss/creation-apps/office'
import engine from '../src/backend/engine.mjs'
const deck={title:'季度报告',slides:[{title:'季度进展',body:'完成需求分析',notes:'数据来自内部月报'},{title:'业务结果',elements:[{type:'chart',chartType:'bar',x:.7,y:1.5,w:6,h:4,series:[{name:'利润',labels:['一月','二月'],values:[-10,20]}]},{type:'table',x:7,y:1.5,w:5,h:2,rows:[['项目','值'],['收入',100]]}]}]}
test('real PPTX contains editable charts, tables and notes; edit preserves unrelated objects',async t=>{
 const f=await fixture(t,engine),first=await f.run(deck),file=first.artifacts[0].path,original=await fs.readFile(file),zip=await officeZip(file)
 assert.equal((await officeText(file,'presentation')).length,2)
 assert.match(await zip.file('ppt/slides/slide2.xml').async('string'),/<a:tbl>/)
 assert.match(await zip.file('ppt/charts/chart1.xml').async('string'),/barChart/)
 assert.ok(Object.keys(zip.files).some(n=>n.startsWith('ppt/embeddings/')&&n.endsWith('.xlsx')))
 assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'),/内部月报/)
 const second=await f.run({title:'更新报告',mode:'edit',sourcePath:file,parentId:first.id,replacements:[{find:'季度进展',replace:'本季度成果',slide:1}]})
 const changed=await officeZip(second.artifacts[0].path);assert.match((await officeText(second.artifacts[0].path,'presentation'))[0].text,/本季度成果/)
 assert.equal(await changed.file('ppt/charts/chart1.xml').async('string'),await zip.file('ppt/charts/chart1.xml').async('string'))
 assert.deepEqual(await fs.readFile(file),original);assert.equal(second.result.version,2);assert.equal(second.result.previewMode,'text')
 assert.equal((await f.actions.get('composer.resolve')({uri:first.result.resourceUri})).path,await fs.realpath(file));assert.equal(first.result.previewIndex,0)
})
test('page bounds and invalid imported edits are rejected',async t=>{
 const f=await fixture(t,engine);await f.run({title:'越界',slides:[{elements:[{type:'text',text:'边界',x:10}]}]},false)
 const first=await f.run(deck);const bad=await f.run({title:'找不到文字',mode:'edit',sourcePath:first.artifacts[0].path,replacements:[{find:'不存在',replace:'替换'}]},false);assert.match(bad.message,/未找到/)
})
