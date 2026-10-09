import { version, reportsDir } from './package-context.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const repo=fileURLToPath(new URL('../../../',import.meta.url)),output=reportsDir,scratch=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-clean-'))
const provenance=JSON.parse(fs.readFileSync(path.join(output,'source-provenance.json'),'utf8'))
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const run=(command,args,cwd,env={})=>execFileSync(command,args,{cwd,stdio:'inherit',env:{...process.env,...env}})
try {
 const core=path.join(scratch,'moss'),apps=path.join(scratch,'moss-apps');fs.mkdirSync(core);fs.mkdirSync(apps)
 for(const [name,dest,sha] of [['core',core,provenance.coreArchiveSha256],['app',apps,provenance.appArchiveSha256]]) {
  const archive=path.join(output,name+'-source.tar.gz');if(hash(archive)!==sha)throw new Error(name+' archive digest mismatch');run('tar',['-xzf',archive,'-C',dest],scratch)
 }
 // Source is isolated. Core's unchanged, installed dependency tree is reused.
 fs.symlinkSync(path.resolve(repo,'../moss/node_modules'),path.join(core,'node_modules'),'dir')
 fs.symlinkSync(path.resolve(repo,'../moss/ui/node_modules'),path.join(core,'ui/node_modules'),'dir')
 fs.cpSync(path.join(core,'packages/app-sdk'),path.join(apps,'vendor/moss-core/packages/app-sdk'),{recursive:true})
 run('bun',['install','--ignore-scripts'],apps)
 run('bun',['run','build'],path.join(apps,'apps/workflow'))
 run('node',['scripts/package-app.mjs','--app','workflow','--skip-build'],apps)
 const zip=path.join(apps,`artifacts/moss.workflow/${version}/moss.workflow-${version}.zip`),actual=hash(zip)
 if(actual!==provenance.appZipSha256)throw new Error(`Rebuilt ZIP differs: ${actual} vs ${provenance.appZipSha256}`)
 run(process.execPath,['apps/workflow/scripts/review-package.mjs'],apps,{MOSS_CORE_ROOT:core})
 const report={passed:true,identicalArchive:true,sha256:actual,coreCommit:provenance.coreCommit,coreDependencies:'Existing lockfile dependencies reused; source isolated',appDependencies:'Fresh bun install from archived lockfile',timestamp:new Date().toISOString()}
 fs.writeFileSync(path.join(output,'clean-source.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{fs.rmSync(scratch,{recursive:true,force:true})}
