import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
const coreRoot=process.env.MOSS_CORE_ROOT||fileURLToPath(new URL('../vendor/moss-core',import.meta.url))
import { validateAppManifest } from '../vendor/moss-core/packages/app-sdk/src/index.mjs'

test('App skill manifest survives normalization and rejects old Hosts and escaping paths',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('../apps/file-cleaner/app.moss.json',import.meta.url),'utf8'))
 const normalized=validateAppManifest(manifest)
 assert.equal(normalized.contributes.skills[0].cli,'dist/backend/cli.mjs')
 assert.throws(()=>validateAppManifest({...manifest,hostApi:'^3.11.0'}),/3.14/)
 assert.throws(()=>validateAppManifest({...manifest,contributes:{...manifest.contributes,skills:[{...manifest.contributes.skills[0],path:'../SKILL.md'}]}}),/path|relative|Invalid/)
})

test('enabled selected App skills resolve the current version and data directory',async()=>{
 const {resolveAppSkills}=await import(pathToFileURL(path.join(coreRoot,'ui/src/apps/app-skills.mjs')))
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-skill-test-'))
 try{
  const installation={appId:'example.cli',enabled:true},instance={id:'default',enabled:true}
  await fs.writeFile(path.join(root,'SKILL.md'),'---\nname: test\ndescription: test\n---\n')
  await fs.writeFile(path.join(root,'cli.mjs'),'')
  const runtime={installations:{list:()=>[installation]},getActivePackage:async()=>({root,manifest:{toolScope:'session',contributes:{skills:[{id:'test',description:'Task CLI',path:'SKILL.md',cli:'cli.mjs'}]}}}),getToolScope:(_id,value)=>value,ensureDefaultInstance:async()=>instance,dataDir:path.join(root,'data'),appDataPath:(...args)=>path.join(...args)}
  assert.equal((await resolveAppSkills(runtime,[])).skills.length,0)
  const result=await resolveAppSkills(runtime,['example.cli'])
  assert.equal(result.skills.length,1);assert(result.prompt.includes('SKILL.md'));assert(result.skills[0].dataDir.endsWith('example.cli/instances/default'))
  installation.enabled=false;assert.equal((await resolveAppSkills(runtime,['example.cli'])).skills.length,0)
  installation.enabled=true;instance.enabled=false;assert.equal((await resolveAppSkills(runtime,['example.cli'])).skills.length,0)
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('session selection accepts an installed CLI-only App and rejects a disabled instance', async () => {
 const {createSessionApps}=await import(pathToFileURL(path.join(coreRoot,'ui/src/apps/session-apps.mjs')))
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-session-skill-'))
 try {
  await fs.writeFile(path.join(root,'SKILL.md'),'Skill')
  await fs.writeFile(path.join(root,'cli.mjs'),'')
  const installation={appId:'example.cli',enabled:true},instance={id:'default',enabled:true}
  const runtime={installations:{get:()=>installation,list:()=>[installation]},listContributions:async()=>({tools:[]}),getActivePackage:async()=>({root,manifest:{toolScope:'session',contributes:{skills:[{id:'test',description:'Task CLI',path:'SKILL.md',cli:'cli.mjs'}]}}}),getToolScope:(_id,value)=>value,ensureDefaultInstance:async()=>instance,dataDir:path.join(root,'data'),appDataPath:(...args)=>path.join(...args)}
  const service=createSessionApps({getRuntime:()=>runtime,getMcpHost:()=>null})
  assert.deepEqual(await service.validateIds(['example.cli']),['example.cli'])
  assert.deepEqual(await service.validateSelection({appIds:['example.cli']}),{appIds:['example.cli'],appServiceIds:[]})
  instance.enabled=false
  await assert.rejects(()=>service.validateIds(['example.cli']),/工具/)
 } finally { await fs.rm(root,{recursive:true,force:true}) }
})
