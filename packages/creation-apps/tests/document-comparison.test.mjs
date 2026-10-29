import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { officeZip, xml, serialize } from '../src/office.mjs'
import { inspectDocument, compareDocuments } from '../src/document-inspection.mjs'
import JSZip from 'jszip'
const paragraph = (text,i) => ({key:`paragraph:${i+1}`,paragraph:i+1,text,signature:text,label:`第 ${i+1} 段`,location:{text}})
const snapshot = lines => ({complete:true,units:lines.map(paragraph)})
test('paragraph insertion, deletion, replacement and duplicate content stay aligned',()=>{
 const before=snapshot(['开头','重复','中间','重复','结尾'])
 const inserted=compareDocuments(before,snapshot(['开头','新增','重复','中间','重复','结尾']))
 assert.equal(inserted.count,1);assert.equal(inserted.changes[0].kind,'added');assert.equal(inserted.changes[0].after.text,'新增')
 const deleted=compareDocuments(before,snapshot(['开头','中间','重复','结尾']))
 assert.equal(deleted.count,1);assert.equal(deleted.changes[0].kind,'removed')
 const revised=compareDocuments(before,snapshot(['开头','新增','重复','中间已修改','重复','结尾']))
 assert.equal(revised.count,2);assert.equal(revised.changes[1].before.text,'中间');assert.equal(revised.changes[1].after.text,'中间已修改')
 const styled=snapshot(['开头','重复','中间','重复','结尾']);styled.units[2].signature='new style'
 assert.equal(compareDocuments(before,styled).count,1)
})
test('large paragraph insertion remains bounded and does not report shifted text as modifications',()=>{
 const lines=Array.from({length:3000},(_,i)=>'段落'+i),after=[...lines];after.splice(900,0,'新段落');after.splice(2100,0,'另一段')
 const comparison=compareDocuments(snapshot(lines),snapshot(after));assert.equal(comparison.count,2)
 assert.equal(compareDocuments(snapshot([]),snapshot(['第一段'])).changes[0].kind,'added')
})
test('real DOCX indexing keeps before/after source positions after insertion',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-compare-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>开头</w:t></w:r></w:p><w:p><w:r><w:t>结尾</w:t></w:r></w:p></w:body></w:document>')
 const source=path.join(root,'before.docx'),target=path.join(root,'after.docx');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}))
 const loaded=await officeZip(source),doc=xml(await loaded.file('word/document.xml').async('string')),body=doc.getElementsByTagName('w:body')[0],added=doc.createElement('w:p'),run=doc.createElement('w:r'),text=doc.createElement('w:t');text.textContent='插入内容';run.appendChild(text);added.appendChild(run);body.insertBefore(added,body.lastChild);loaded.file('word/document.xml',serialize(doc));await fs.writeFile(target,await loaded.generateAsync({type:'nodebuffer'}))
 const diff=compareDocuments(await inspectDocument(source),await inspectDocument(target));assert.equal(diff.count,1);assert.equal(diff.changes[0].after.location.text,'插入内容')
})


test('an inserted paragraph beside a rewritten paragraph is not paired with the old content',()=>{
 const comparison=compareDocuments(snapshot(['首段','交付日期为十月。','尾段']),snapshot(['首段','这里插入一段说明。','交付日期为十一月。','尾段']))
 assert.equal(comparison.count,2)
 const added=comparison.changes.find(c=>c.kind==='added'),changed=comparison.changes.find(c=>c.kind==='changed')
 assert.equal(added.after.text,'这里插入一段说明。');assert.equal(changed.before.text,'交付日期为十月。');assert.equal(changed.after.text,'交付日期为十一月。')
})
