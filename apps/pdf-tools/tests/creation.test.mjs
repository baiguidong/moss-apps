import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createCanvas,loadImage} from '@napi-rs/canvas'
import { inspect,validate,execute } from '../src/backend/engine.mjs'
import { present } from '../src/backend/presentation.mjs'
test('Chinese PDF creation, page rendering and retained version identity',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-pdf-create-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const context={files:[],outputDir:root,signal:new AbortController().signal,progress(){}}
 const result=await execute({...context,input:validate({title:'项目报告',options:{mode:'create',content:'本周项目进度\n中文渲染与导出检查。\n'+('完成阶段目标。\n'.repeat(50))}},[])})
 const pdf=result.files.find(f=>f.kind==='pdf');assert.equal((await inspect(pdf.path)).metadata.pages,2)
 assert.equal(result.files.filter(f=>f.kind==='image').length,2)
 const image=await loadImage(result.files.find(f=>f.kind==='image').path),canvas=createCanvas(image.width,image.height),context2d=canvas.getContext('2d');context2d.drawImage(image,0,0)
 // Each Chinese glyph must actually paint, even when PDF text extraction succeeds.
 for(let i=0;i<6;i++){const data=context2d.getImageData(Math.floor(50*1.25+i*15)+1,45,13,24).data;let ink=0;for(let p=0;p<data.length;p+=4)if(data[p]<200&&data[p+1]<200&&data[p+2]<200&&data[p+3]>100)ink++;assert.ok(ink>8,`Chinese glyph ${i+1} did not render (${ink} pixels)`)}
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await getDocument({data:new Uint8Array(await fs.readFile(pdf.path))}).promise
 try {assert.match((await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join(''),/中文渲染/)}finally{await doc.destroy()}
 const file={id:'source',...pdf,...await inspect(pdf.path)},id='11111111-1111-4111-8111-111111111111'
 const normalized=validate({fileIds:['source'],parentId:id,title:'再次渲染',options:{mode:'render'}},[file]);assert.equal(normalized.parentId,id);assert.equal(normalized.title,'再次渲染')
 const pages=await execute({...context,input:normalized,files:[file]});assert.equal(pages.files.length,2);assert.ok((await fs.stat(pages.files[0].path)).size>1000)
 const task={id:'revision',input:{parentId:id},outputs:['source']},shown=present(task,[{...file,name:'report.pdf'}],[{id,input:{}}]);assert.equal(shown.result.version,2);assert.equal(shown.result.workId,id);assert.equal(shown.result.downloads.length,1)
})
