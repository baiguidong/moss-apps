// Execute shipped workers/CLIs/MCP with empty user data under an OS network sandbox.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {fork,spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {selectApps,repoRoot,optionValue} from './lib.mjs'
import {unzipSync} from 'fflate'
import {sourcePath} from '../vendor/moss-core/packages/app-runtime/src/packages/source.mjs'
import {hash,TaskStore,WORKER_READY_MESSAGE,WORKER_START_MESSAGE} from '../packages/engine-apps/src/runtime.mjs'
import {restoreBundledAsset} from '../packages/engine-apps/src/bundled.mjs'
import {platformAsset} from '../packages/engine-apps/src/platform.mjs'
const execute=promisify(execFile)
export const LOCAL_APPS=['moss.image-tools','moss.pdf','moss.transcription','moss.file-management','moss.document','moss.code-map']
const args=process.argv.slice(2)
const platform = `${process.platform}-${process.arch}`
if(!['darwin-arm64','linux-x64'].includes(platform))throw new Error(`Bundled native verification is unavailable on ${platform}`)
if(!args.includes('--sandboxed')){
 const profile='(version 1)(allow default)(deny network-outbound (remote ip "*:*"))(allow network-outbound (remote ip "localhost:*"))'
 const command = process.platform === 'linux' ? 'sudo' : '/usr/bin/sandbox-exec'
 const prefix = process.platform === 'linux' ? ['-n','unshare','--net','--','sh','-c','ip link set lo up; exec "$@"','moss-offline-check'] : ['-p',profile]
 const child=spawn(command,[...prefix,process.execPath,fileURLToPath(import.meta.url),...args,'--sandboxed'],{stdio:'inherit',env:process.env})
 child.once('error',error=>{console.error(error);process.exitCode=1})
 child.once('exit',code=>{process.exitCode=code??1})
}else{
 const apps=selectApps(args).filter(app=>LOCAL_APPS.includes(app.manifest.id))
 if(!apps.length)throw new Error('No matching local Apps')
 for(const app of apps)await verify(app)
}
async function verify(app){
 const name=app.directoryName,id=app.manifest.id
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'moss-bundled-offline-')))
 const archive=path.join(repoRoot,'artifacts',id,app.manifest.version,`${id}-${app.manifest.version}-${platform}.zip`)
 const pkg=path.resolve(optionValue(args,'--package')||path.join(temporary,'package'))
 if(!optionValue(args,'--package')) {
  let total=0
  const entries=unzipSync(await fs.readFile(archive),{filter:entry=>{
   sourcePath(pkg,entry.name);total+=entry.originalSize
   assert(entry.originalSize<=128*1024**2&&total<=512*1024**2,'Host package size limits');return true
  }})
  for(const [name,bytes] of Object.entries(entries)) {
   const file=sourcePath(pkg,name)
   if(name.endsWith('/')){await fs.mkdir(file,{recursive:true});continue}
   await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'})
  }
 }
 const manifest=JSON.parse(await fs.readFile(path.join(pkg,'app.moss.json')))
 assert.deepEqual(manifest.platforms,[platform])
 const dataDir=path.join(temporary,'empty-data'),outputDir=path.join(temporary,'outputs');await fs.mkdir(dataDir);await fs.mkdir(outputDir)
 const checks=[],dependencies=[]
 const require=createRequire(path.join(pkg,'dist/backend/main.mjs'))
 try{
  for(const name of ['engine','czkawka','ffmpeg','ffprobe','pdf-engine','model']){
   const raw=await fs.readFile(path.join(pkg,'resources',name+'.json')).then(JSON.parse).catch(()=>null);if(!raw)continue
   const spec=platformAsset(raw)
   const file=name==='model'?path.join(pkg,'dist/models',spec.executable):path.join(pkg,'dist/engines',spec.id,spec.version,spec.executable)
   if(await fs.stat(file).catch(()=>null))assert.equal(await hash(file),spec.binarySha256,`${spec.id} must be shipped and verified`)
   else {
    const descriptor=JSON.parse(await fs.readFile(file+'.bundle.json'));assert.equal(descriptor.sha256,spec.binarySha256)
    for(let i=0;i<descriptor.parts.length;i++)assert.equal(await hash(file+`.part-${i}`),descriptor.parts[i].sha256)
   }
   dependencies.push(spec.id)
  }
  const localWorker=input=>new Promise((resolve,reject)=>{
   const child=fork(path.join(pkg,'dist/backend/worker.mjs'),[],{cwd:temporary,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_PATH:''}})
   let tail='',settled=false;const timer=setTimeout(()=>{child.kill();reject(new Error('Worker timeout'))},180000)
   child.stdout.on('data',b=>{tail=(tail+b).slice(-3000)});child.stderr.on('data',b=>{tail=(tail+b).slice(-3000)})
   child.on('error',reject);child.on('message',m=>{if(m.type==='result'){settled=true;resolve(m.result)}else if(m.type==='error'){settled=true;reject(new Error(m.message))}})
   child.on('exit',code=>{clearTimeout(timer);if(!settled)reject(new Error(`Worker ${code}: ${tail}`))})
   child.send({type:'run',input:input.input,files:input.files,outputDir,dataDir})
  })
  if(name==='image-tools'){
   const sharp=require('sharp'),file=path.join(temporary,'image.png');await sharp({create:{width:100,height:80,channels:3,background:'#287968'}}).png().toFile(file)
   const result=await localWorker({input:{fileIds:['input'],options:{format:'webp',quality:80,width:50}},files:[{id:'input',name:'image.png',path:file,kind:'image',metadata:await sharp(file).metadata()}]})
   assert.equal((await sharp(result.files[0].path).metadata()).width,50);checks.push('Packaged sharp/native libvips converts a real image')
  }else if(name==='pdf-tools'){
   const {PDFDocument,StandardFonts}=require('pdf-lib'),pdf=await PDFDocument.create(),page=pdf.addPage([500,300]),font=await pdf.embedFont(StandardFonts.Helvetica)
   page.drawText('MOSS OFFLINE OCR',{x:40,y:180,size:28,font});const file=path.join(temporary,'scan.pdf');await fs.writeFile(file,await pdf.save())
   const result=await localWorker({input:{fileIds:['input'],options:{mode:'ocr',pages:[{fileId:'input',page:0,rotation:0}],language:'eng'}},files:[{id:'input',name:'scan.pdf',path:file}]})
   const text=result.files.find(f=>f.path.endsWith('.txt'));assert.match(await fs.readFile(text.path,'utf8'),/MOSS\s+OFFLINE\s+OCR/);checks.push('Packaged PDF.js/Canvas/Tesseract and language data produce searchable OCR')
  }else if(name==='transcription'){
   const rate=16000,samples=rate*2,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40)
   const file=path.join(temporary,'silence.wav');await fs.writeFile(file,wav)
   const result=await localWorker({input:{fileIds:['input'],options:{language:'en'}},files:[{id:'input',name:'silence.wav',path:file}]})
   const transcript=JSON.parse(await fs.readFile(result.files.find(f=>f.kind==='transcript').path));assert.equal(transcript.duration,2);assert(Array.isArray(transcript.segments));checks.push('Packaged FFmpeg, Whisper native module and bundled base model complete inference')
  }else if(id==='moss.file-management'){
   checks.push(...await verifyFileManagement(pkg,manifest,temporary,dataDir))
  }else if(name==='document-converter'){
   const file=path.join(temporary,'中文.md');await fs.writeFile(file,'# OFFLINE PANDOC\n\n本地文档\n')
   // Exercise bundled Pandoc directly for DOCX/HTML, without starting a desktop
   // Office renderer. Session Apps deliberately no longer expose CLI run.
   const spec=platformAsset(JSON.parse(await fs.readFile(path.join(pkg,'resources/engine.json'))))
   const pandoc=await restoreBundledAsset(path.join(pkg,'dist/engines',spec.id,spec.version,spec.executable),path.join(dataDir,'pandoc'),spec.binarySha256);await fs.chmod(pandoc,0o755)
   const docx=path.join(outputDir,'document.docx'),html=path.join(outputDir,'preview.html')
   await execute(pandoc,[file,'--to=docx','--output',docx],{timeout:180000})
   await execute(pandoc,[docx,'--to=html5','--standalone','--output',html],{timeout:180000})
   assert.match(await fs.readFile(html,'utf8'),/OFFLINE PANDOC/)
   const pdf=await sessionTask(pkg,manifest,temporary,{paths:[file],to:'pdf'})
   assert.equal((await fs.readFile(pdf.artifacts.find(a=>a.kind==='pdf').path)).subarray(0,5).toString(),'%PDF-')
   checks.push('Packaged Pandoc creates DOCX with HTML preview; session worker uses bundled Typst to create PDF in its workspace')
  }else if(name==='code-map'){
   const testRequire=createRequire(path.join(repoRoot,'packages/engine-apps/package.json'))
   const {Client}=testRequire('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=testRequire('@modelcontextprotocol/sdk/client/stdio.js')
   const client=new Client({name:'moss-offline-check',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(pkg,'dist/backend/mcp.mjs'),'--data-dir',dataDir],stderr:'pipe',env:{...process.env,NODE_PATH:''}})
   try{
    await client.connect(transport);transport.stderr?.resume();assert.equal((await client.listTools()).tools.length,17)
    const repo=path.join(temporary,'repository');await fs.mkdir(repo);await fs.writeFile(path.join(repo,'math.ts'),'export function add(a:number,b:number){return a+b}\n')
    const indexed=await client.callTool({name:'index_repository',arguments:{repo_path:repo}});assert(!indexed.isError,JSON.stringify(indexed));const value=indexed.structuredContent||JSON.parse(indexed.content.find(c=>c.type==='text').text);assert(value.nodes>0)
    const result=await client.callTool({name:'search_graph',arguments:{project:value.project,name_pattern:'add',format:'json'}});assert(!result.isError);assert(JSON.stringify(result).includes('add'));checks.push('Packaged MCP server exposes 17 tools, indexes source and queries symbols')
   }finally{await client.close()}
  }
  const report={appId:id,version:app.manifest.version,platform,network:'OS sandbox denies external IP connections',emptyUserData:true,archiveSha256:optionValue(args,'--package')?null:await hash(archive),dependencies,checks,checkedAt:new Date().toISOString()}
  const output=path.join(repoRoot,'artifacts/offline-apps');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,id+'.json'),JSON.stringify(report,null,2)+'\n');console.log(`PASS offline ${id}: ${checks.join('; ')}`)
 }finally{
  // The MCP process may still be closing its index when its transport exits.
  await fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100})
 }
}

async function verifyFileManagement(pkg, manifest, temporary, dataDir) {
 const store = new TaskStore(dataDir), password = 'isolated file management verification'
 const submit = async (input, env) => {
  const task = await store.create(input, 'offline-verification')
  const result = await runEngineWorker(pkg, store, task, env)
  assert.equal(result.status, 'succeeded', result.message)
  return result
 }
 const scans = path.join(temporary, "扫描 中文 '[]$;&"), repo = path.join(temporary, 'repo'), target = path.join(temporary, 'restored')
 await Promise.all([scans, repo, target].map(directory => fs.mkdir(directory)))
 const payload = 'duplicate'.repeat(2000)
 await fs.writeFile(path.join(scans, 'a.txt'), payload)
 await fs.copyFile(path.join(scans, 'a.txt'), path.join(scans, 'b.txt'))
 assert.equal(manifest.backend.lifecycle, 'on-demand')
 assert(manifest.contributes.tools.some(tool => tool.id === 'cleanup_scan' && tool.effect === 'read'))
 const scan = await submit({ command: 'dup', paths: [scans], options: { 'minimal-file-size': '1' } }, { RESTIC_PASSWORD: '' })
 assert.equal(scan.result.fileCount, 2)
 assert(scan.result.groups[0].files.every(file => file.trashIdentity))
 assert.equal(typeof JSON.parse(await fs.readFile(scan.artifacts[0].path, 'utf8')), 'object')
 const empty = path.join(scans, 'empty-folder')
 await fs.mkdir(path.join(empty, 'nested'), { recursive: true })
 const emptyFolders = await submit({ command: 'empty-folders', paths: [scans] }, { RESTIC_PASSWORD: '' })
 assert(emptyFolders.result.groups.some(group => group.files.some(file => file.path === empty && file.trashIdentity)))

 const fixDirectory = path.join(temporary, 'extensions')
 await fs.mkdir(fixDirectory)
 const original = path.join(fixDirectory, 'photo.jpg'), occupied = path.join(fixDirectory, 'photo.png')
 await fs.writeFile(original, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
 await fs.writeFile(occupied, 'preserve this file')
 const extensionScan = await submit({ command: 'ext', paths: [fixDirectory] }, { RESTIC_PASSWORD: '' })
 const fix = await store.create({ command: 'ext', paths: [fixDirectory], options: { 'fix-extensions': true },
  confirmChanges: true, followUp: { id: extensionScan.id, operation: 'fix' } }, 'offline-verification')
 const conflict = await runEngineWorker(pkg, store, fix, { RESTIC_PASSWORD: '' })
 assert.equal(conflict.status, 'partial')
 assert.match(conflict.warnings, /target file already exists/)
 assert.equal(await fs.readFile(occupied, 'utf8'), 'preserve this file')
 assert((await fs.stat(original)).size > 0)

 const binaries = await fs.readdir(path.join(pkg, 'dist/engines'))
 assert(!binaries.includes('ffmpeg') && !binaries.includes('ffprobe'), 'Video dependencies belong to the media studio')
 const video = await store.create({ command: 'video', paths: [scans] }, 'offline-verification')
 const missing = await runEngineWorker(pkg, store, video, { RESTIC_PASSWORD: '', MOSS_VIDEO_FFMPEG: '', MOSS_VIDEO_FFPROBE: '' })
 assert.equal(missing.status, 'failed')
 assert.match(missing.message, /安装多媒体工坊.*moss\.media-studio/)

 const env = { RESTIC_PASSWORD: password }
 await submit({ command: 'init', repo }, env)
 const backup = await submit({ command: 'backup', repo, paths: [scans] }, env)
 const snapshots = await submit({ command: 'snapshots', repo }, env)
 const snapshot = snapshots.result.snapshots[0].id
 assert(snapshot.startsWith(backup.result.summary.snapshot_id))
 const restored = await submit({ command: 'restore', repo, snapshot, target }, env)
 assert.equal(await fs.readFile(path.join(target, scans, 'a.txt'), 'utf8'), payload)
 const tasks = await store.list()
 assert(tasks.some(task => task.id === scan.id) && tasks.some(task => task.id === restored.id))
 assert(!JSON.stringify(tasks).includes(password))
 return ['Packaged Czkawka scans files and missing media studio blocks video with an install prompt', 'Packaged Restic initializes, backs up and restores file contents using the same task store']
}

async function sessionTask(pkg,manifest,temporary,input){
 const sessionId='offline-check',directory=path.join(temporary,'workspace','artifacts',manifest.id,sessionId),cacheDir=path.join(temporary,'empty-data')
 const store=new TaskStore(directory,{cacheDir,sessionId}),task=await store.create(input,'offline-verification')
 const result=await runEngineWorker(pkg,store,task,{MOSS_ENGINE_CACHE_DIR:cacheDir,MOSS_TASK_SESSION_ID:sessionId})
 assert.equal(result.status,'succeeded',result.message)
 assert.equal(result.sessionId,sessionId)
 assert(result.artifacts.every(file=>file.path.startsWith(directory+path.sep)),'outputs must belong to the session workspace')
 assert.equal(new URL(result.result.resourceUri).searchParams.get('session'),sessionId)
 return result
}

async function runEngineWorker(pkg,store,task,env = {}){
 // Use the shipped worker's parent handshake and session environment, just as
 // the Backend queue does. Host lifecycle/storage isolation has separate tests.
 await new Promise((resolve,reject)=>{
  const child=fork(path.join(pkg,'dist/backend/worker.mjs'),[store.dataDir,task.id],{cwd:pkg,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_PATH:'',...env}})
  let tail='',error,killTimer
  const timer=setTimeout(()=>{error=new Error('Engine worker timeout');child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000)},180000)
  child.stdout.on('data',chunk=>{tail=(tail+chunk).slice(-6000)});child.stderr.on('data',chunk=>{tail=(tail+chunk).slice(-6000)})
  child.once('error',value=>{error=value})
  child.on('message',message=>{if(message.type===WORKER_READY_MESSAGE)child.send({type:WORKER_START_MESSAGE},value=>{if(value){error=value;child.kill('SIGTERM')}})})
  child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(killTimer);if(error||code!==0)reject(error||new Error(`Engine worker ${code??signal}: ${tail}`));else resolve()})
 })
 return store.get(task.id)
}
