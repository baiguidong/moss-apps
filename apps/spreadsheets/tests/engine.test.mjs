import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { fixture } from '@moss/creation-apps/testing'
import { officeZip, xml } from '@moss/creation-apps/office'
import engine from '../src/backend/engine.mjs'
const budget = { title:'月度预算', sheets:[{name:'预算',rows:[['项目','金额'],['收入',100],['支出',30],['结余',{formula:'B2-B3',numFmt:'0.00'}]],charts:[{type:'bar',labels:'A2:A3',series:[{name:'金额',range:'B2:B3'}]}]}] }
test('imported dates preserve workbook dates and times across timezones and date systems', async t => {
 const f=await fixture(t,engine),originalTimezone=process.env.TZ
 try {
  for(const timezone of ['America/Los_Angeles','Asia/Shanghai','UTC']) {
   process.env.TZ=timezone
   for(const date1904 of [false,true]) {
    const book=new ExcelJS.Workbook();book.properties.date1904=date1904
    const sheet=book.addWorksheet('日期');sheet.addRow(['日期','公式日期'])
    sheet.addRow([new Date('2026-10-01T00:15:00Z'),{formula:'A2',result:new Date('2026-10-01T00:15:00Z')}])
    for(const address of ['A2','B2'])sheet.getCell(address).numFmt='yyyy-mm-dd hh:mm'
    const source=path.join(f.root,'dates.xlsx');await book.xlsx.writeFile(source)
    const result=await f.run({title:'读取日期',mode:'read',sourcePath:source})
    const read=new ExcelJS.Workbook();await read.xlsx.readFile(result.artifacts[0].path)
    assert.equal(read.getWorksheet('日期').getCell('A2').value.toISOString(),'2026-10-01T00:15:00.000Z')
    assert.equal(read.properties.date1904===true,date1904)
   }
  }
 } finally {
  if(originalTimezone===undefined)delete process.env.TZ
  else process.env.TZ=originalTimezone
 }
})
test('editable XLSX formulas/charts, import edits, resource persistence and versions', async t => {
 const f=await fixture(t,engine),first=await f.run(budget),source=first.artifacts[0].path,original=await fs.readFile(source)
 assert.deepEqual(first.result.sheets,[{name:'预算',rows:4,columns:2}]);
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(source);assert.equal(book.getWorksheet('预算').getCell('B4').result,70)
 const zip=await officeZip(source);assert.match(await zip.file('xl/charts/chart1.xml').async('string'),/预算.*B2:B3/)
 const revised=await f.run({title:'预算调整',mode:'edit',sourcePath:source,parentId:first.id,edits:[{sheet:'预算',cell:'B2',value:200},{sheet:'预算',cell:'C2',value:5},{sheet:'预算',cell:'A3',value:null}]})
 const updated=new ExcelJS.Workbook();await updated.xlsx.readFile(revised.artifacts[0].path);assert.equal(updated.getWorksheet('预算').getCell('B4').result,170);assert.equal(updated.getWorksheet('预算').getCell('A3').text,'')
 const zip2=await officeZip(revised.artifacts[0].path);assert.equal(await zip.file('xl/charts/chart1.xml').async('string'),await zip2.file('xl/charts/chart1.xml').async('string'))
 assert.deepEqual(await fs.readFile(source),original);assert.equal(revised.result.version,2);assert.equal(revised.result.workId,first.id)
 const resolved=await f.actions.get('composer.resolve')({uri:revised.result.resourceUri});assert.equal(resolved.path,await fs.realpath(revised.artifacts[0].path));assert.equal(resolved.version,2)
 assert.ok((await f.actions.get('composer.list')({query:'预算'})).items.length===2)
 await assert.rejects(f.actions.get('composer.resolve')({uri:'moss-spreadsheets://works/../../outside'}))
 const read=await f.run({title:'读取原表',mode:'read',sourcePath:source});assert.deepEqual(await fs.readFile(read.artifacts[0].path),original)
})
test('invalid formulas, chart data and oversized edits fail visibly',async t=>{
 const f=await fixture(t,engine)
 const broken=await f.run({title:'错误公式',sheets:[{name:'数据',rows:[[{formula:'1/0'}]]}]},false);assert.match(broken.message,/公式计算失败/)
 await f.run({...budget,sheets:[{...budget.sheets[0],rows:[['项目','金额'],['一',0],['二',0]],charts:[{type:'pie',labels:'A2:A3',series:[{range:'B2:B3'}]}]}]},false)
 const good=await f.run(budget);await f.run({title:'越界',mode:'edit',sourcePath:good.artifacts[0].path,edits:[{sheet:'预算',cell:'A10001',value:1}]},false)
})

test('zero, false and empty formula caches survive charts, read and edit', async t => {
 const f=await fixture(t,engine)
 const first=await f.run({title:'零预算',sheets:[{name:'预算',rows:[
  ['分类','预算','支出','剩余','使用率','条件','空文本'],
  ['餐饮',0,{formula:"SUMIFS('明细'!B2:B10000,'明细'!A2:A10000,A2)",numFmt:'#,##0.00'},{formula:'B2-C2'},{formula:'IF(B2>0,C2/B2,0)',numFmt:'0.0%'},{formula:'1=2'},{formula:'IF(B2=0,"","有预算")'}],
  ['日期',{formula:'DATE(2026,10,1)',numFmt:'yyyy-mm-dd'}],
  ['金额',{value:1234.5,numFmt:'#,##0.00'}],
 ],charts:[{type:'bar',labels:'A2:A2',series:[{name:'支出',range:'C2:C2'}]}]},
 {name:'明细',rows:[['分类','金额'],['餐饮',0]]}]})
 const inspect=async (task,emptyResult='')=>{
  const rows=JSON.parse(await fs.readFile(task.artifacts.find(file=>path.basename(file.path)==='workbook.json').path,'utf8'))[0].rows
  assert.deepEqual(rows[1].slice(2).map(cell=>cell.result??null),[0,0,0,false,emptyResult])
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(task.artifacts[0].path)
  assert.deepEqual(['C2','D2','E2','F2'].map(address=>book.getWorksheet('预算').getCell(address).result),[0,0,0,false])
  // ExcelJS reads an empty OOXML string cache as undefined; it must never
  // become an object label or be confused with the numeric/boolean caches.
  assert.equal(book.getWorksheet('预算').getCell('G2').result??'','')
 }
 await inspect(first)
 const chart=await (await officeZip(first.artifacts[0].path)).file('xl/charts/chart1.xml').async('string')
 assert.match(chart,/<c:numCache>.*<c:v>0<\/c:v>/)
 assert.deepEqual(first.result.presentation.items.map(item=>item.resource_uri),[first.result.resourceUri])
 assert.ok(!first.artifacts.some(file=>file.kind==='html'||file.purpose==='render'))
 assert.equal(first.result.quality,undefined)
 assert.equal(first.result.visualReview,undefined)
 assert.ok(!f.actions.has('creation.verify'))
 await assert.rejects(fs.access(path.join(path.dirname(first.artifacts[0].path),'office-preview')), {code:'ENOENT'})
 const download=await f.actions.get('composer.resolve')({uri:first.result.presentation.items[0].resource_uri})
 assert.equal(download.path,await fs.realpath(first.artifacts[0].path))
 await inspect(await f.run({title:'读取零预算',mode:'read',sourcePath:first.artifacts[0].path}),null)
 await inspect(await f.run({title:'修改零预算',mode:'edit',sourcePath:first.artifacts[0].path,edits:[{sheet:'预算',cell:'B2',value:0}]}))
})

test('legacy workbooks reopen in the workbook viewer and inspect current edits', async t => {
 const f=await fixture(t,engine), task=await f.run(budget), {resourceUri}=task.result
 const legacyIndex=task.artifacts.push({name:'交互预览',path:path.join(path.dirname(task.artifacts[0].path),'preview.html'),kind:'html',purpose:'interactive-preview'})-1
 const legacyUri='moss-spreadsheets://files/'+task.id+'/'+legacyIndex
 task.result.quality={state:'stale'}
 task.result.visualReview={status:'unavailable'}
 task.result.interactivePreview={resourceUri:legacyUri}
 task.result.displayMarkdown+='\n\n[旧预览]('+legacyUri+')'
 task.result.presentation.items.push({resource_uri:legacyUri,role:'supporting'})
 await f.store.write(task)
 const {result}=engine.taskView(task)
 assert.deepEqual(result.presentation.items.map(item=>item.resource_uri),[resourceUri])
 assert.ok(!result.quality&&!result.visualReview&&!result.interactivePreview)
 assert.ok(!result.displayMarkdown.includes(legacyUri))
 const resolve=f.actions.get('composer.resolve')
 for(const uri of [resourceUri,legacyUri]){
   const file=await resolve({uri})
   assert.equal(file.path,await fs.realpath(task.artifacts[0].path))
   assert.ok(!file.creation.quality&&!file.creation.sourceSha256&&!file.creation.rendering)
 }
 await engine.register({registerAction:(key,fn)=>f.actions.set(key,fn)},{dataDir:f.root},{getTask:id=>f.store.get(id)})
 const {revision}=await f.actions.get('editor.open')({uri:resourceUri})
 const save=()=>f.actions.get('editor.save')({uri:resourceUri,revision,edits:[{sheet:'预算',cell:'B2',value:135}]},{signal:new AbortController().signal})
 await save()
 await assert.rejects(save(),/别处保存/)
 const index=await f.actions.get('creation.inspect')({id:task.id,sheet:'预算',range:'B2'})
 assert.match(index.units[0].text,/135/)
 await assert.rejects(fs.access(task.artifacts[legacyIndex].path),{code:'ENOENT'})
})
