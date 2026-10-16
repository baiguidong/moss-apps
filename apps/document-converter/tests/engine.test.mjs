import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import engine,{buildArgs} from '../src/backend/engine.mjs'
test('literal input and metadata, controlled output and format validation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-doc-')),file=path.join(root,"-中文 '[]$;&.md")
 try{await fs.writeFile(file,'# test');const {args,output}=await buildArgs({paths:[file],from:'markdown',to:'docx',options:{metadata:['title=中文 $;',"author=A 'B'"],toc:true}},root)
 assert(args.includes('--metadata=title=中文 $;'));assert(args.includes("--metadata=author=A 'B'"));assert.equal(args.at(-1),await fs.realpath(file));assert.equal(path.dirname(output),root);assert(output.endsWith('.docx'))
 await assert.rejects(engine.validate({paths:[file],to:'nonsense'}),/输出格式/)
 await assert.rejects(engine.validate({paths:[file],to:'docx',extraArgs:['--output=/tmp/untracked']}),/输出/)
 await assert.rejects(engine.validate({paths:[file],to:'docx',options:{toc:'false'}}),/布尔值/)
 await engine.validate({mode:'inspect',query:'print-default-template',value:'html5'})
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
