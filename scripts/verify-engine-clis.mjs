// Real engine checks, separate from portable source-package unit tests.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { TaskStore, executeTask, hash, run } from '../packages/engine-apps/src/runtime.mjs'
import cleaner from '../apps/file-cleaner/src/backend/engine.mjs'
import document from '../apps/document-converter/src/backend/engine.mjs'
const repo=fileURLToPath(new URL('..',import.meta.url)),root=path.join(repo,'artifacts/engine-apps/verification')
const binaries=process.env.MOSS_ENGINE_FIXTURE_ROOT
if(!binaries)throw new Error('Set MOSS_ENGINE_FIXTURE_ROOT to the verified upstream downloads; see delivery documentation.')
const require=createRequire(path.join(repo,'apps/image-tools/package.json')),sharp=require('sharp')
await fs.mkdir(root,{recursive:true})
const fixtures=path.join(root,'fixtures');await fs.mkdir(fixtures,{recursive:true})
const scans=path.join(fixtures,"扫描 中文 '[]$;&");await fs.mkdir(scans,{recursive:true})
await fs.writeFile(path.join(scans,'重复 文档.txt'),'Moss local task\n'.repeat(1000));await fs.copyFile(path.join(scans,'重复 文档.txt'),path.join(scans,'another.txt'))
await fs.mkdir(path.join(scans,'empty-folder'),{recursive:true});await fs.writeFile(path.join(scans,'empty.txt'),'');await fs.writeFile(path.join(scans,'cache.tmp'),'temporary')
await fs.symlink('missing-target',path.join(scans,'broken-link')).catch(e=>{if(e.code!=='EEXIST')throw e})
const svg=Buffer.from('<svg width="480" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="320" fill="#ead6b2"/><circle cx="350" cy="90" r="42" fill="#d99465"/><path d="M0 290L150 110L310 320Z" fill="#48746a"/><path d="M200 320L380 180L480 280V320Z" fill="#365a54"/></svg>')
await sharp(svg).png().toFile(path.join(scans,'山景.png'));await sharp(svg).resize(460,307).png().toFile(path.join(scans,'山景 副本.png'))
await sharp(svg).jpeg().withMetadata().toFile(path.join(scans,'Photo.JPG'))
await run(path.join(binaries,'ffmpeg-bin'),['-nostdin','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=160x90:r=10:d=2','-c:v','libx264',path.join(scans,'sample.mp4')])
const checks=[]
async function data(app){
 const dataDir=path.join(root,'data',app)
 for(const file of ['engine','ffmpeg','ffprobe']){
  const spec=await fs.readFile(path.join(repo,'apps',app,'resources',file+'.json'),'utf8').then(JSON.parse).catch(()=>null);if(!spec)continue
  const source=path.join(binaries,{czkawka:'mac_czkawka_cli_arm64',pandoc:'pandoc-bin',ffmpeg:'ffmpeg-bin',ffprobe:'ffprobe-bin'}[spec.id])
  assert.equal(await hash(source),spec.binarySha256)
  const target=path.join(dataDir,'engines',spec.id,spec.version,spec.executable);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);await fs.chmod(target,0o755)
 }
 return new TaskStore(dataDir)
}
const cleanStore=await data('file-cleaner')
for(const command of (await cleaner.catalog({})).commands){
 const input={command:command.id,paths:[scans],options:{}}
 if(command.options.some(o=>o.key==='minimal-file-size'))input.options['minimal-file-size']='1'
 if(command.id==='video-optimizer')input.subcommand='transcode'
 const task=await executeTask(cleaner,cleanStore,await cleanStore.create(input,'test'))
 assert.equal(task.status,'succeeded',`${command.id}: ${task.message}`)
 const json=JSON.parse(await fs.readFile(task.artifacts[0].path,'utf8'));assert(json&&typeof json==='object')
 if(command.id==='dup')assert(task.result.fileCount>=2)
 if(command.id==='image')assert(task.result.fileCount>=2)
 checks.push(`Czkawka ${command.id}: real report parsed`)
}
const documentStore=await data('document-converter'),input=path.join(fixtures,"-输入 中文 '[]$;&.md")
await fs.writeFile(input,'# 中文标题\n\n| 项目 | 金额 |\n|---|---|\n|资料|128|\n')
for(const to of ['docx','html5','gfm','epub3','odt','pptx','typst','json']){
 const task=await executeTask(document,documentStore,await documentStore.create({paths:[input],from:'markdown',to,options:{metadata:['title=中文标题']}},'test'))
 assert.equal(task.status,'succeeded',`${to}: ${task.message}`)
 assert((await fs.stat(task.artifacts[0].path)).size>0)
 if(['docx','odt','epub3'].includes(to))assert((await fs.readFile(task.artifacts.find(a=>a.kind==='html').path,'utf8')).includes('128'))
 checks.push(`Pandoc ${to}: real output ${['docx','odt','epub3'].includes(to)?'reopened and previewed':'generated'}`)
}
const broken=path.join(fixtures,'invalid.docx');await fs.writeFile(broken,'not a document')
const batch=await executeTask(document,documentStore,await documentStore.create({mode:'batch',paths:[input,broken],to:'html5'},'test'))
assert.equal(batch.status,'partial');assert.equal(batch.result.files.filter(f=>f.status==='succeeded').length,1);checks.push('Batch retains successful artifact and reports invalid input as partial failure')
// Mutation checks are confined to disposable fixtures; verify files, not exit codes.
const mutations=path.join(fixtures,'disposable-cleanup');await fs.mkdir(mutations,{recursive:true})
await fs.writeFile(path.join(mutations,'a.txt'),'duplicate'.repeat(2000));await fs.copyFile(path.join(mutations,'a.txt'),path.join(mutations,'b.txt'))
const cleanup={command:'dup',paths:[mutations],options:{'minimal-file-size':'1','delete-method':'AEO','dry-run':true},confirmChanges:true}
const dry=await executeTask(cleaner,cleanStore,await cleanStore.create(cleanup,'test'));assert.equal(dry.status,'succeeded',dry.message);assert.equal((await fs.readdir(mutations)).length,2)
const deleted=await executeTask(cleaner,cleanStore,await cleanStore.create({...cleanup,options:{...cleanup.options,'dry-run':false}},'test'));assert.equal(deleted.status,'succeeded',deleted.message);assert.equal((await fs.readdir(mutations)).length,1);checks.push('Duplicate dry run leaves two files; AEO cleanup retains exactly one matching original')
const videos=path.join(fixtures,'disposable-video');await fs.mkdir(videos,{recursive:true});await fs.copyFile(path.join(scans,'sample.mp4'),path.join(videos,'clip.mp4'))
const optimized=await executeTask(cleaner,cleanStore,await cleanStore.create({command:'video-optimizer',paths:[videos],options:{},subcommand:'transcode',suboptions:{'fix-videos':true,'target-codec':'h264','quality':'28'},confirmChanges:true},'test'))
assert.equal(optimized.status,'succeeded',optimized.message)
const converted=(await fs.readdir(videos)).filter(file=>file!=='clip.mp4');assert(converted.length>0,'video output was not created')
const probe=JSON.parse((await run(path.join(binaries,'ffprobe-bin'),['-v','error','-show_streams','-of','json',path.join(videos,converted[0])])).stdout);assert(probe.streams.some(stream=>stream.codec_name==='h264'));checks.push('Actual video transcoding creates a readable H.264 output verified by ffprobe')
const defaults=path.join(fixtures,'defaults.yaml');await fs.writeFile(defaults,'writer: plain\ntoc: true\noutput-file: ignored-output.txt\n')
const configured=await executeTask(document,documentStore,await documentStore.create({paths:[input],to:'docx',options:{defaults,toc:false}},'test'));assert.equal(configured.status,'succeeded',configured.message);assert(configured.artifacts.some(a=>a.kind==='html'));assert(configured.argv.includes('--toc=false'));checks.push('Pandoc defaults, explicit false and managed format/output work together')
const mediaSource=path.join(fixtures,'media.md');await fs.writeFile(mediaSource,'# Embedded picture\n\n![Mountain](<'+path.join(scans,'山景.png')+'>)\n')
const withImage=await executeTask(document,documentStore,await documentStore.create({paths:[mediaSource],to:'docx'},'test'));assert.equal(withImage.status,'succeeded',withImage.message)
const extracted=await executeTask(document,documentStore,await documentStore.create({paths:[withImage.artifacts[0].path],to:'html5',extractMedia:true},'test'));assert.equal(extracted.status,'succeeded',extracted.message);assert(extracted.artifacts.some(a=>a.kind==='image'));checks.push('Embedded DOCX image is extracted, registered and previewable')
const badArgs=await executeTask(cleaner,cleanStore,await cleanStore.create({command:'dup',paths:[scans],options:{'thread-number':'invalid'}},'test'));assert.equal(badArgs.status,'failed');assert(badArgs.argv.includes('invalid'));checks.push('Failed upstream calls preserve actual argv for Agent repair')
const report={platform:`${process.platform}-${process.arch}`,checkedAt:new Date().toISOString(),checks}
await fs.writeFile(path.join(root,'cli-report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
