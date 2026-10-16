import {test,expect} from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {listApps,selectApps,repoRoot} from './lib.mjs'
import {planReleases} from './plan-releases.mjs'
const ids=['moss.image-tools','moss.pdf-tools','moss.transcription','moss.file-cleaner','moss.document-converter','moss.code-map']
test('all six local Apps enter the native CI and automatic release matrix',()=>{
 const apps=listApps().filter(app=>ids.includes(app.manifest.id))
 expect(apps).toHaveLength(6)
 expect(planReleases(apps,[],'a'.repeat(40)).candidates.map(x=>x.app_id).sort()).toEqual([...ids].sort())
 const mac=selectApps(['--platform-packages','--supported-platform','darwin-arm64']).map(app=>app.manifest.id)
 const linux=selectApps(['--supported-platform','linux-x64']).map(app=>app.manifest.id)
 for(const app of apps){
  expect(app.manifest.platforms).toEqual(['darwin-arm64']);expect(app.marketplace.platforms).toEqual(app.manifest.platforms)
  expect(mac).toContain(app.manifest.id);expect(linux).not.toContain(app.manifest.id)
  const context=JSON.parse(execFileSync(process.execPath,['scripts/release-context.mjs',`${app.manifest.id}-v${app.manifest.version}`],{cwd:repoRoot,encoding:'utf8'}))
  expect(context.variants).toBe(true);expect(JSON.parse(context.platforms).include).toEqual([{platform:'darwin-arm64',os:'macos-15'}])
 }
})
test('the market generator registers all six native artifacts and icons',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-six-app-market-')),records=path.join(root,'records'),site=path.join(root,'site');await fs.mkdir(records)
 try{
  for(const app of listApps().filter(app=>ids.includes(app.manifest.id))){const id=app.manifest.id;await fs.writeFile(path.join(records,id+'.release.json'),JSON.stringify({schemaVersion:1,app:{id,displayName:app.manifest.displayName,publisher:app.manifest.publisher},version:{version:app.manifest.version,hostApi:app.manifest.hostApi,permissions:app.manifest.permissions,platforms:app.manifest.platforms,artifacts:{'darwin-arm64':{downloadUrl:`https://example.com/${id}.zip`,sha256:'a'.repeat(64)}}}}))}
  execFileSync(process.execPath,['scripts/build-catalog.mjs','--artifacts',records,'--output',site],{cwd:repoRoot})
  const catalog=JSON.parse(await fs.readFile(path.join(site,'v1/index.json'),'utf8'));expect(catalog.apps.map(app=>app.id).sort()).toEqual([...ids].sort())
  for(const id of ids){const app=JSON.parse(await fs.readFile(path.join(site,'v1/apps',id+'.json'),'utf8'));expect(app.versions[0].artifacts['darwin-arm64']).toBeTruthy();expect(app.iconUrl).toContain(id);expect(app.category).toBe(id==='moss.code-map'?'development':'knowledge')}
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
