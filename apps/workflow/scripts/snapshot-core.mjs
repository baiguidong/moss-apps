import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {gzipSync} from 'node:zlib'
import {fileURLToPath} from 'node:url'
const repo=fileURLToPath(new URL('../../../',import.meta.url)),core=path.resolve(repo,'../moss'),vendor=path.join(repo,'vendor/moss-core')
const output=path.join(repo,'artifacts/moss.workflow/verification/0.1.9');fs.mkdirSync(output,{recursive:true})
const hash=value=>createHash('sha256').update(value).digest('hex')
const git=(cwd,args,env)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',env:{...process.env,...env}}).trim()
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-snapshot-'))
try {
 const env={GIT_INDEX_FILE:path.join(temp,'index')}
 git(core,['read-tree','HEAD'],env)
 const excluded=new Set(['ui/src/renderer-react/components/chat/assistant-message.tsx','ui/src/renderer-react/components/chat/fork-session-button.tsx','ui/tests/fixtures/chat-selection.tsx'])
 const changed=git(core,['diff','HEAD','--name-only']).split('\n').filter(file=>file&&!excluded.has(file))
 const added=git(core,['ls-files','--others','--exclude-standard']).split('\n').filter(file=>/^(packages\/app-sdk\/src\/execution\/|src\/services\/appExecution\/|ui\/src\/apps\/app-(execution-host|task-session|composer)\.mjs|ui\/tests\/app-(execution-host|task-session|composer)\.test\.|ui\/src\/renderer-react\/(components\/app-conversation-flow\.tsx|lib\/app-composer\.tsx)|ui\/docs\/(app-execution-host|workflow-app-))/.test(file))
 if(changed.length||added.length)git(core,['add','--',...changed,...added],env)
 const base=git(core,['rev-parse','HEAD']),tree=git(core,['write-tree'],env)
 const commit=tree===git(core,['rev-parse','HEAD^{tree}']) ? base : git(core,['-c','user.name=Moss Local Snapshot','-c','user.email=snapshot@localhost','commit-tree',tree,'-p',base,'-m','Workflow App 0.1.9 compatible Core source snapshot'],env)
 const tar=execFileSync('git',['-C',core,'archive','--format=tar',commit],{maxBuffer:256*1024*1024});const archive=gzipSync(tar)
 fs.writeFileSync(path.join(output,'core-source.tar.gz'),archive)
 const files={};for(const file of git(vendor,['ls-files','--','packages/app-sdk','packages/app-runtime']).split('\n'))if(file&&!file.includes('node_modules')){
  const body=fs.readFileSync(path.join(vendor,file));files[file]=hash(body)
  if(hash(fs.readFileSync(path.join(core,file)))!==files[file])throw new Error('Pinned vendor SDK differs from Core: '+file)
 }
 const metadata={version:'2.8.0',baseCommit:git(vendor,['rev-parse','HEAD']),files}
 const appFiles={};const walk=(dir)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','.git'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())appFiles[path.relative(repo,file)]=hash(fs.readFileSync(file))}};walk(path.join(repo,'apps/workflow'))
 const appArchive=path.join(output,'app-source.tar.gz')
 execFileSync('tar',['--exclude=node_modules','--exclude=dist','-czf',appArchive,'-C',repo,'apps/workflow','scripts/lib.mjs','scripts/package-app.mjs','package.json','bun.lock'])
 const report={appArchiveSha256:hash(fs.readFileSync(appArchive)),coreBase:base,coreCommit:commit,coreTree:tree,coreArchiveSha256:hash(archive),coreChangedPaths:[...changed,...added],sdk:metadata,appSourceFiles:appFiles,appZipSha256:hash(fs.readFileSync(path.join(repo,'artifacts/moss.workflow/0.1.9/moss.workflow-0.1.9.zip'))),excludedUnrelatedPaths:[...excluded]}
 fs.writeFileSync(path.join(output,'source-provenance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({commit,tree,archiveBytes:archive.length,sdkFiles:Object.keys(files).length}))
}finally{fs.rmSync(temp,{recursive:true,force:true})}
