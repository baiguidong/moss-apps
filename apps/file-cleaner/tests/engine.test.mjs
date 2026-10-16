import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import engine, {buildArgs} from '../src/backend/engine.mjs'
test('multiple literal paths and repeated rules survive argument construction',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-clean-'))
 try{const dirs=await Promise.all(["-中文 '[]$;&",'other directory'].map(async name=>{const p=path.join(root,name);await fs.mkdir(p);return fs.realpath(p)}))
 const {args}=await buildArgs({command:'dup',paths:dirs,options:{'excluded-items':['*.tmp','*/space dir/*'],'minimal-file-size':'1'}},root)
 assert.deepEqual(args.slice(0,5),['dup','--directories',dirs[0],'--directories',dirs[1]])
 assert(args.includes('*/space dir/*'));assert(args.includes('-W'))
 await assert.rejects(engine.validate({command:'dup',paths:dirs,options:{'delete-method':'AEO'}}),/修改/)
 await assert.rejects(engine.validate({command:'dup',paths:dirs,extraArgs:['-DAEO']}),/修改/)
 await assert.rejects(engine.validate({command:'dup',paths:dirs,extraArgs:['-QyD']}),/无效/)
 await assert.rejects(engine.validate({command:'dup',paths:dirs,extraArgs:['--compact-file-to-save','/tmp/override']}),/无效|管理/)
 await assert.rejects(engine.validate({command:'dup',paths:dirs,options:{'thread-number':2}}),/字符串/)
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('all command and nested optimizer schemas are available',async()=>{
 const data=await engine.catalog({})
 assert.equal(data.commands.length,14)
 const transcode=data.commands.find(c=>c.id==='video-optimizer').subcommands.find(c=>c.id==='transcode')
 assert(transcode.options.some(o=>o.key==='target-codec'))
})
