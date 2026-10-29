import fs from 'node:fs/promises'
import path from 'node:path'
import { atomic, hash } from '@moss/engine-apps/runtime'
import { prepareBaseline, finishInspection, registerWorkflow } from '@moss/creation-apps/workflow'
import { renderOfficeFile } from '@moss/creation-apps/office-render'
import { present } from './presentation.mjs'
async function pdfText(source,signal) {
  const {DOMMatrix,ImageData,Path2D}=await import('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix,ImageData,Path2D})
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf=await getDocument({data:new Uint8Array(await fs.readFile(source)),isEvalSupported:false}).promise,pages=[]
  try {for(let i=1;i<=pdf.numPages;i++){signal?.throwIfAborted();const content=await (await pdf.getPage(i)).getTextContent();pages.push(content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu,'$1'))}}finally{await pdf.destroy()}
  return pages
}
const instances=new WeakMap()
export function pdfWorkflow(service) {
  if(instances.has(service))return instances.get(service)
  const actions=new Map(),pending=new Map()
  const directory=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('任务 ID 无效');return path.join(service.root,'creation-review',id)}
  const load=id=>fs.readFile(path.join(directory(id),'workflow.json'),'utf8').then(JSON.parse,()=>null)
  const initialize=async id=>{
    const cached=await load(id);if(cached)return cached
    const task=service.state.tasks.find(t=>t.id===id)
    if(!task||task.status!=='succeeded')throw new Error('PDF 任务尚未完成')
    const shown=present(task,service.state.files,service.state.tasks)
    const artifacts=await Promise.all(shown.result.downloads.map(async f=>({name:f.name,path:await service.filePath(f),kind:f.kind,purpose:f.kind==='image'?'render':undefined,page:f.metadata?.page})))
    const source=artifacts.find(a=>a.kind==='pdf');if(!source)throw new Error('本任务未生成 PDF；请对生成 PDF 的任务进行检查')
    const ctx={directory:directory(id),signal:new AbortController().signal,pdfText};await fs.mkdir(ctx.directory,{recursive:true})
    const parentId=task.input.parentId,parent=parentId?await get(parentId):null
    const firstInput=(task.input.fileIds||[]).map(fid=>service.state.files.find(f=>f.id===fid)).find(f=>f?.kind==='pdf')
    const sourcePath=firstInput?await service.filePath(firstInput):undefined
    const baseline=await prepareBaseline({sourcePath},parent,ctx)
    const images=artifacts.filter(a=>a.kind==='image'&&a.page).map(a=>({page:a.page,path:a.path})).sort((a,b)=>a.page-b.page)
    const count=shown.result.downloads.find(f=>f.kind==='pdf')?.metadata?.pages
    let visualReview
    if(images.length&&images.length===count)visualReview={status:'rendered',sourcePath:source.path,sourceSha256:await hash(source.path),pageCount:count,pages:images,visuallyVerified:false,pdfPath:source.path}
    else {const rendered=await renderOfficeFile(source.path,path.join(ctx.directory,'office-preview'),ctx);visualReview=rendered.result;artifacts.push(...rendered.files)}
    const output={artifacts,result:{...shown.result,visualReview}}
    await finishInspection(output,task.input,ctx,baseline,'moss-pdf',shown.result.resourceUri)
    const value={...task,artifacts:output.artifacts,result:output.result};await atomic(path.join(ctx.directory,'workflow.json'),value);return value
  }
  const get=id=>{if(!pending.has(id)){const promise=initialize(id);pending.set(id,promise);promise.finally(()=>pending.delete(id)).catch(()=>{})}return pending.get(id)}
  registerWorkflow({registerAction:(name,fn)=>actions.set(name,fn)},{get,directory,write:task=>atomic(path.join(directory(task.id),'workflow.json'),task)},'moss-pdf')
  const value={get,load,invoke:(name,input)=>actions.get(name)(input),async resolve(id,index){
    const task=await get(id),file=task.artifacts[index]
    if(!file||!Number.isInteger(index)||!['comparison','comparison-source','inspection'].includes(file.purpose))throw new Error('PDF 核验资源不存在')
    const resolved=await fs.realpath(file.path),relative=path.relative(await fs.realpath(directory(id)),resolved)
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('PDF 核验资源路径无效')
    return {kind:'file',name:file.name,path:resolved,resourceUri:`moss-pdf://files/${id}/${index}`,creation:{version:task.result.version,quality:task.result.quality,comparison:task.result.comparison,rendering:task.result.rendering},...(file.purpose==='comparison'?{presentation:{type:'document-comparison'}}:{})}
  }}
  instances.set(service,value);return value
}
