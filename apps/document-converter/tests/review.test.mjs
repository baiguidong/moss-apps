import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { JSZip, officeZip } from '@moss/creation-apps/office'
import { fixture } from '@moss/creation-apps/testing'
import engine from '../src/backend/engine.mjs'
test('DOCX review writes native revisions/comments and preserves original parts',async t=>{
 const f=await fixture(t,engine),zip=new JSZip(),file=path.join(f.root,'source.docx')
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>合同金额为一万元。</w:t></w:r></w:p><w:p><w:r><w:t>付款期限为七日。</w:t></w:r></w:p></w:body></w:document>')
 zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
 zip.file('word/styles.xml','unchanged styles');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));const original=await fs.readFile(file)
 const result=await f.run({title:'合同审阅',mode:'review',sourcePath:file,edits:[{find:'一万元',replace:'两万元'}],comments:[{find:'付款期限',text:'请确认付款日期'}]})
 const output=await officeZip(result.artifacts[0].path),doc=await output.file('word/document.xml').async('string')
 assert.match(doc,/<w:del /);assert.match(doc,/<w:ins /);assert.match(doc,/<w:delText[^>]*>一万元/);assert.match(doc,/两万元/);assert.match(doc,/commentRangeStart/)
 assert.match(await output.file('word/comments.xml').async('string'),/请确认付款日期/)
 assert.match(await output.file('word/_rels/document.xml.rels').async('string'),/relationships\/comments/)
 assert.equal(await output.file('word/styles.xml').async('string'),'unchanged styles');assert.deepEqual(await fs.readFile(file),original)
 assert.deepEqual([result.result.changes,result.result.comments],[1,1])
 await f.run({title:'无法定位',mode:'review',sourcePath:file,edits:[{find:'不存在',replace:'内容'}]},false)
})

test('paragraph-scoped revisions span styled runs without touching repeated text elsewhere',async t=>{
 const f=await fixture(t,engine),zip=new JSZip(),file=path.join(f.root,'split.docx')
 const paragraph='<w:p><w:r><w:t>验收后</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>七日</w:t></w:r><w:r><w:t>内付款。</w:t></w:r></w:p>'
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraph+paragraph+'</w:body></w:document>')
 zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}))
 const bad=await f.run({title:'重复文字',mode:'review',sourcePath:file,edits:[{find:'验收后七日',replace:'验收后三十日'}]},false);assert.match(bad.message,/唯一/)
 const changed=await f.run({title:'指定段落',mode:'review',sourcePath:file,edits:[{paragraph:2,find:'验收后七日',replace:'验收后三十日'}]})
 const output=await officeZip(changed.artifacts[0].path),doc=await output.file('word/document.xml').async('string');assert.ok(doc.includes(paragraph));assert.match(doc,/验收后三十日/);assert.match(doc,/<w:rPr><w:b\/><\/w:rPr><w:delText/)
 const units=(await f.actions.get('creation.inspect')({id:changed.id})).units;assert.equal(units[1].text,'验收后三十日内付款。');assert.match(units[1].citation.uri,/#text=/);assert.equal(changed.result.comparison.count,1)
})
