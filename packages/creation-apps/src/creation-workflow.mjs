import fs from 'node:fs/promises'
import path from 'node:path'
import { hash, atomic } from '@moss/engine-apps/runtime'
import { renderOfficeFile, renderingSummary } from './office-render.mjs'
import { inspectDocument, compareDocuments, citation } from './document-inspection.mjs'
const native = artifacts => artifacts.find(a=>/\.(docx|pptx|xlsx|pdf)$/i.test(a.path)&&a.purpose!=='render')
const workflowSchemes=new Set(['moss-document','moss-spreadsheets','moss-presentations'])
export const supportsWorkflow = scheme => workflowSchemes.has(scheme)
export async function prepareBaseline(input, parent, ctx) {
  if(input.mode==='read')return null
  const source=input.sourcePath || (parent&&native(parent.artifacts)?.path)
  if(!source||!/^\.(docx|pptx|xlsx|pdf)$/i.test(path.extname(source)))return null
  if(!path.isAbsolute(source)||(await fs.stat(source)).size>250*1024**2)throw new Error('参考文件需要完整路径，大小不超过 250 MiB')
  const snapshot=await inspectDocument(source,ctx)
  if(parent&&input.sourcePath){const original=native(parent.artifacts);if(original&&await hash(original.path)!==snapshot.sourceSha256)throw new Error('sourcePath 与 parentId 的原文件不一致，请使用同一版本')}
  return {source,snapshot,uri:parent?.result?.resourceUri}
}
export async function finishInspection(output, input, ctx, baseline, scheme, resourceUri) {
  const source=native(output.artifacts);if(!source)return
  if(baseline&&await hash(baseline.source)!==baseline.snapshot.sourceSha256)throw new Error('原文件在修改期间变化，请重新读取后修改')
  const snapshot=await inspectDocument(source.path,ctx),id=path.basename(ctx.directory),uri=resourceUri||`${scheme}://works/${id}`
  const index=output.artifacts.length,file=path.join(ctx.directory,'content-index.json')
  await atomic(file,snapshot);output.artifacts.push({name:'内容索引.json',path:file,kind:'json',purpose:'inspection'})
  const visual=output.result?.visualReview
  for(const snapshotOfVersion of [baseline?.snapshot,snapshot])for(const unit of snapshotOfVersion?.units||[]){
    const media=unit.detail?.imagePath
    if(media&&!output.artifacts.some(a=>a.path===media))output.artifacts.push({name:'对比图片'+path.extname(media),path:media,kind:'image',purpose:'comparison-media'})
  }
  output.result={...output.result,inspection:{index,sourceSha256:snapshot.sourceSha256,complete:snapshot.complete,units:snapshot.units.length},
    rendering:renderingSummary(visual),
    quality:{state:snapshot.checks.some(c=>c.severity==='error')?'needs-repair':'pending',checks:snapshot.checks,reviewedPages:0,totalPages:visual?.pageCount||null,visualReview:'pending'},
    references:snapshot.units.filter(u=>u.location).slice(0,8).map(u=>citation(uri,u.location,u.label)),
    nextAction:'使用 inspect 读取内容及精确引用。查看 visualReview.pages 的真实图片后调用 verify 记录逐页 observations 和 issues；有问题创建带 parentId 的修正版并重新核验。'}
  if(baseline){
    const comparison=compareDocuments(baseline.snapshot,snapshot)
    // A source imported from elsewhere is copied into this task so comparison remains reproducible.
    let beforeUri=baseline.uri
    if(!beforeUri){const target=path.join(ctx.directory,'before'+path.extname(baseline.source));await fs.copyFile(baseline.source,target);const n=output.artifacts.length;output.artifacts.push({name:'修改前原件'+path.extname(target),path:target,kind:'document',purpose:'comparison-source'});beforeUri=`${scheme}://files/${id}/${n}`}
    const data={schema:'moss.document-comparison/v1',...comparison,before:{uri:beforeUri,sha256:baseline.snapshot.sourceSha256},after:{uri,sha256:snapshot.sourceSha256}}
    const comparePath=path.join(ctx.directory,'comparison.json'),compareIndex=output.artifacts.length
    await atomic(comparePath,data);output.artifacts.push({name:'修改对比',path:comparePath,kind:'json',purpose:'comparison'})
    output.result.comparison={count:comparison.count,complete:comparison.complete,truncated:comparison.truncated,resourceUri:`${scheme}://files/${id}/${compareIndex}`,displayMarkdown:`[查看 ${comparison.count} 处修改](${scheme}://files/${id}/${compareIndex})`}
  }
}
async function indexOf(task){
  const index=task.result?.inspection?.index,file=task.artifacts[index]
  if(task.status!=='succeeded'||!file||file.purpose!=='inspection')throw new Error('此任务尚无内容索引，请重新读取或生成作品')
  return JSON.parse(await fs.readFile(file.path,'utf8'))
}
const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)
const rangeOf=value=>{const m=/^([A-Z]{1,3})([1-9]\d*)(?::([A-Z]{1,3})([1-9]\d*))?$/.exec(value||'');if(!m||col(m[3]||m[1])<col(m[1])||Number(m[4]||m[2])<Number(m[2]))throw new Error('单元格范围无效');return {left:col(m[1]),right:col(m[3]||m[1]),top:Number(m[2]),bottom:Number(m[4]||m[2])}}
export function registerWorkflow(backend,store,scheme) {
  const locks=new Map()
  backend.registerAction('creation.inspect',async({id,page,sheet,range,offset=0,limit=50})=>{
    const task=await store.get(id),snapshot=await indexOf(task)
    if(await hash(native(task.artifacts).path)!==snapshot.sourceSha256)throw new Error('文件已在外部变化，请重新读取作品')
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw new Error('读取分页无效')
    const bounds=range?rangeOf(range):null
    if(bounds&&!sheet)throw new Error('读取范围需要工作表名称')
    const units=snapshot.units.filter(u=>(page===undefined||u.location?.page===page)&&(sheet===undefined||u.location?.sheet===sheet)).filter(u=>{if(!bounds)return true;const cell=rangeOf(u.location.range);return cell.left>=bounds.left&&cell.left<=bounds.right&&cell.top>=bounds.top&&cell.top<=bounds.bottom})
    return {sourceSha256:snapshot.sourceSha256,total:units.length,offset,hasMore:offset+limit<units.length,checks:snapshot.checks,units:units.slice(offset,offset+limit).map(({signature,...u})=>({...u,...(u.location?{citation:citation(task.result.resourceUri,u.location,u.label)}:{})}))}
  })
  backend.registerAction('creation.verify',input=>{
    const previous=locks.get(input.id)||Promise.resolve()
    const pending=previous.catch(()=>{}).then(async()=>{
      const task=await store.get(input.id),snapshot=await indexOf(task),source=native(task.artifacts).path
      let visual=task.result.visualReview
      if(await hash(source)!==snapshot.sourceSha256)throw new Error('文件已变化，原核验失效，请重新生成页面')
      if(input.render){
        if(input.pages)throw new Error('生成页图和提交核验请分两次调用，先查看新增图片')
        if(input.sourceSha256!==snapshot.sourceSha256)throw new Error('核验版本不匹配')
        if(typeof input.render!=='object'||Array.isArray(input.render))throw new Error('生成页图参数无效')
        if(input.render.startPage&&visual?.pageCount&&input.render.startPage>visual.pageCount)throw new Error('生成页码超出文档范围')
        const rendered=await renderOfficeFile(source,path.join(store.directory(task.id),'office-preview'),{startPage:input.render.startPage,maxPages:input.render.count??8})
        if(await hash(source)!==snapshot.sourceSha256)throw new Error('文件在生成页图期间变化，请重新读取')
        for(const file of rendered.files)if(!task.artifacts.some(a=>a.path===file.path))task.artifacts.push(file)
        visual={...rendered.result,visuallyVerified:visual?.visuallyVerified===true&&rendered.result.status==='rendered'}
        task.result.visualReview=visual;task.result.rendering=renderingSummary(visual)
        task.result.quality={...task.result.quality,totalPages:visual.pageCount||task.result.quality.totalPages}
        await store.write(task)
      }
      if(!input.pages)return {sourceSha256:snapshot.sourceSha256,quality:task.result.quality,renderStatus:visual?.status,rendering:renderingSummary(visual),pages:visual?.pages||[],nextRender:visual?.nextPage?{id:input.id,sourceSha256:snapshot.sourceSha256,render:{startPage:visual.nextPage,count:8}}:null,instruction:'逐页查看这些图片；提交每页实际观察和问题；nextRender 不为空时可用它继续生成下一批。不要把渲染成功视为视觉检查通过。'}
      if(input.sourceSha256!==snapshot.sourceSha256)throw new Error('核验版本不匹配')
      if(!Array.isArray(input.pages)||!input.pages.length||input.pages.length>100)throw new Error('请提交 1–100 页核验记录')
      const reportPath=path.join(store.directory(task.id),'visual-review.json')
      const saved=await fs.readFile(reportPath,'utf8').then(JSON.parse,()=>({sourceSha256:snapshot.sourceSha256,pages:[]}))
      if(saved.sourceSha256!==snapshot.sourceSha256)throw new Error('核验记录对应另一版本')
      const reviewed=new Map(saved.pages.map(page=>[page.page,page])),seen=new Set()
      for(const page of input.pages){
        if(!Number.isInteger(page.page)||!visual?.pages?.some(p=>p.page===page.page)||seen.has(page.page))throw new Error('核验页不存在或重复')
        if(typeof page.observations!=='string'||!page.observations.trim()||page.observations.length>2000||!Array.isArray(page.issues)||page.issues.length>30||page.issues.some(i=>!['error','warning'].includes(i.severity)||typeof i.message!=='string'||!i.message.trim()||i.message.length>1000))throw new Error('每页需要实际观察和有效的问题清单')
        if(reviewed.get(page.page)?.issues.some(i=>i.severity==='error')&&!page.issues.some(i=>i.severity==='error'))throw new Error('此版本已记录错误，请修改文件并创建新版本后重新核验')
        seen.add(page.page);reviewed.set(page.page,{page:page.page,observations:page.observations,issues:page.issues,reviewedBy:'model',reviewedAt:new Date().toISOString()})
      }
      const pages=[...reviewed.values()].sort((a,b)=>a.page-b.page),checks=[...snapshot.checks,...pages.flatMap(p=>p.issues.map(i=>({...i,location:{page:p.page}})))]
      const complete=visual?.status==='rendered'&&pages.length===visual.pageCount
      const state=checks.some(c=>c.severity==='error')?'needs-repair':!complete?'pending':checks.length?'reviewed-with-warnings':'reviewed'
      await atomic(reportPath,{sourceSha256:snapshot.sourceSha256,pages})
      task.result.quality={state,checks,reviewedPages:pages.length,totalPages:visual?.pageCount||null,visualReview:complete?'complete':'partial',reviewedBy:'model'}
      task.result.visualReview={...visual,visuallyVerified:complete&&!checks.some(c=>c.severity==='error'),reviewedBy:'model'}
      await store.write(task)
      return {sourceSha256:snapshot.sourceSha256,quality:task.result.quality,remainingPages:visual?.pages?.filter(p=>!reviewed.has(p.page))||[],rendering:renderingSummary(visual),nextRender:visual?.nextPage?{id:input.id,sourceSha256:snapshot.sourceSha256,render:{startPage:visual.nextPage,count:8}}:null,nextAction:state==='needs-repair'?'修改问题后创建带 parentId 的新版本，重新检查新版本页面':complete?'使用原文件引用交付；说明尚存的警告':'继续查看并记录剩余页面'}
    })
    locks.set(input.id,pending);pending.finally(()=>{if(locks.get(input.id)===pending)locks.delete(input.id)}).catch(()=>{})
    return pending
  })
}
