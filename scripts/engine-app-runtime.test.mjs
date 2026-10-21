import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {bundleAsset} from '../packages/engine-apps/src/bundle-build.mjs'
import {restoreBundledAsset} from '../packages/engine-apps/src/bundled.mjs'
import {prepareBinary} from '../packages/engine-apps/src/download.mjs'
import {ensureBinary,hash,run,TaskStore,executeTask} from '../packages/engine-apps/src/runtime.mjs'
import {platformAsset} from '../packages/engine-apps/src/platform.mjs'

test('native assets select their pinned OS and architecture without foreign fallback', () => {
 const spec={id:'engine',platform:'darwin-arm64',version:'1',sha256:'mac',url:'https://example.com/mac',targets:{'linux-x64':{version:'2',sha256:'linux',url:'https://example.com/linux'}}}
 assert.equal(platformAsset(spec,'darwin-arm64').sha256,'mac')
 assert.deepEqual(platformAsset(spec,'linux-x64'),{id:'engine',platform:'linux-x64',version:'2',sha256:'linux',url:'https://example.com/linux'})
 assert.throws(()=>platformAsset(spec,'linux-arm64'),/不支持/)
 assert.equal(spec.platform,'darwin-arm64')
})

test('build-only download, ZIP/TGZ/TXZ extraction, pinned hashes and corruption handling',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-engine-download-'))
 const content=Buffer.from('#!/bin/sh\nprintf "fixture engine"\n'),file=path.join(root,'engine')
 await fs.writeFile(file,content)
 execFileSync('/usr/bin/zip',['-q',path.join(root,'engine.zip'),'engine'],{cwd:root})
 execFileSync('/usr/bin/tar',['-czf',path.join(root,'engine.tgz'),'engine'],{cwd:root})
 execFileSync('/usr/bin/tar',['-cJf',path.join(root,'engine.txz'),'engine'],{cwd:root})
 const server=http.createServer(async(req,res)=>{try{res.end(await fs.readFile(path.join(root,req.url.slice(1))))}catch{res.writeHead(404);res.end()}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try {
  for(const [archive,name] of [['binary','engine'],['zip','engine.zip'],['tgz','engine.tgz'],['txz','engine.txz']]) {
   const spec={id:archive,version:'test',platform:`${process.platform}-${process.arch}`,url:`http://127.0.0.1:${server.address().port}/${name}`,sha256:await hash(path.join(root,name)),binarySha256:await hash(file),archive,member:'engine',executable:'engine'}
   const target=await prepareBinary(spec,path.join(root,'data'))
   assert.deepEqual(await fs.readFile(target),content)
   await fs.chmod(target,0o600);assert.equal(await ensureBinary(spec,path.join(root,'data')),target);assert((await fs.stat(target)).mode&0o100)
   await fs.writeFile(target,'corrupt');await assert.rejects(ensureBinary(spec,path.join(root,'data')),/校验失败/)
   await assert.rejects(prepareBinary({...spec,id:'wrong-'+archive,sha256:'0'.repeat(64)},path.join(root,'data')),/校验失败/)
  }
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true})}
})

test('literal argv and a separate TaskStore cancellation stop a live CLI process',async()=>{
 const literal="中文 '[]$;& $(touch never)"
 assert.deepEqual(JSON.parse((await run(process.execPath,['-e','console.log(JSON.stringify(process.argv.slice(1)))',literal])).stdout),[literal])
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-engine-cancel-'))
 try {
  const store=new TaskStore(root),task=await store.create({command:'fixture'})
  const ready=path.join(root,'ready')
  const job=executeTask({execute:(_input,ctx)=>run(process.execPath,['-e','require("fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',ready],{signal:ctx.signal})},store,task)
  for(let n=0;n<100&&!(await fs.stat(ready).catch(()=>null));n++)await new Promise(resolve=>setTimeout(resolve,20))
  const childPid=Number(await fs.readFile(ready,'utf8'))
  await new TaskStore(root).cancel(task.id)
  assert.equal((await job).status,'canceled');assert.equal((await store.get(task.id)).status,'canceled');assert.throws(()=>process.kill(childPid,0))
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('a disconnected parent cannot start engine work after the start signal', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-engine-disconnect-'))
 try {
  const store=new TaskStore(root),task=await store.create({})
  const reason=Object.assign(new Error('任务后台连接已断开'),{code:'ENGINE_PARENT_DISCONNECTED'})
  let called=false
  const result=await executeTask({execute:async()=>{called=true;return {status:'succeeded'}}},store,task,AbortSignal.abort(reason))
  assert.equal(called,false)
  assert.equal(result.status,'interrupted')
  assert.equal((await store.read(task.id)).status,'interrupted')
 } finally {await fs.rm(root,{recursive:true,force:true})}
})

test('runtime refuses missing dependencies without making a download request',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-offline-runtime-'))
 let requests=0;const server=http.createServer((_req,res)=>{requests++;res.end('unexpected')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{await assert.rejects(ensureBinary({id:'missing-fixture',version:'1',platform:`${process.platform}-${process.arch}`,executable:'engine',url:`http://127.0.0.1:${server.address().port}`},root),/安装包缺少/);assert.equal(requests,0)}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true})}
})

test('bundled chunks restore exact bytes offline; corruption, ordering, size and abort cannot leave a usable cache',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-bundled-assets-'))
 try {
  const source=path.join(root,'source'),bundled=path.join(root,'package','engine'),cached=path.join(root,'cache','engine')
  const content=randomBytes(30000);await fs.writeFile(source,content);const sha=await hash(source)
  await bundleAsset(source,bundled,sha,{threshold:0,partBytes:8192})
  const descriptor=JSON.parse(await fs.readFile(bundled+'.bundle.json'));assert(descriptor.parts.length>2)
  const second=path.join(root,'second','engine');await bundleAsset(source,second,sha,{threshold:0,partBytes:8192})
  assert.deepEqual(JSON.parse(await fs.readFile(second+'.bundle.json')),descriptor,'deterministic rebuild')
  await Promise.all([restoreBundledAsset(bundled,cached,sha),restoreBundledAsset(bundled,cached,sha)])
  assert.deepEqual(await fs.readFile(cached),content)
  await fs.rm(cached)
  const part0=await fs.readFile(bundled+'.part-0'),part1=await fs.readFile(bundled+'.part-1')
  await fs.writeFile(bundled+'.part-1',part0)
  await assert.rejects(restoreBundledAsset(bundled,cached,sha))
  assert.equal(await fs.stat(cached).catch(()=>null),null)
  await fs.writeFile(bundled+'.part-1',part1)
  await fs.writeFile(bundled+'.bundle.json',JSON.stringify({...descriptor,size:1}))
  await assert.rejects(restoreBundledAsset(bundled,cached,sha),/超过声明大小/)
  await fs.writeFile(bundled+'.bundle.json',JSON.stringify(descriptor))
  await assert.rejects(restoreBundledAsset(bundled,cached,sha,AbortSignal.abort()))
  assert.deepEqual(await fs.readdir(path.dirname(cached)),[],'no partial outputs')
  await restoreBundledAsset(bundled,cached,sha);assert.deepEqual(await fs.readFile(cached),content)
  await fs.writeFile(cached,'corrupt');await assert.rejects(restoreBundledAsset(bundled,cached,sha),/校验失败/)
 } finally {await fs.rm(root,{recursive:true,force:true})}
})
