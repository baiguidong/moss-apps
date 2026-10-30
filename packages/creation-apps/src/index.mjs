import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskStore, sessionResourceUri } from '@moss/engine-apps/runtime'
import { supportsWorkflow, registerWorkflow, prepareBaseline, finishInspection } from './creation-workflow.mjs'
import { officeExtensions, renderOfficeFile } from './office-render.mjs'
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
export const safeName = value => String(value).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0,120) || '作品'
export const jsonScript = value => JSON.stringify(value).replace(/</g,'\\u003c')
export function htmlDocument(title, body, css = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>html{color-scheme:light dark}body{margin:20px;font:15px/1.65 system-ui,sans-serif;color:light-dark(#172033,#e4ece5);background:light-dark(#fff,#202621)}*{box-sizing:border-box}h1{font-size:25px}h2{font-size:20px}table{border-collapse:collapse}td,th{padding:8px 12px;border:1px solid light-dark(#dce2e9,#465349);text-align:left}button,input,select{font:inherit;padding:7px 10px}button{cursor:pointer}img{max-width:100%}@media(max-width:500px){body{margin:10px}}${css}</style></head><body>${body}</body></html>`
}
export async function inputFile(file, extensions, max = 64 * 1024 ** 2) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请提供本地文件的完整路径')
  const target = await fs.realpath(file), stat = await fs.stat(target)
  if (!stat.isFile() || stat.size > max || !extensions.includes(path.extname(target).toLowerCase())) throw new Error('文件格式或大小不受支持')
  return target
}
export function validateTitle(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('标题需要 1–120 字')
  if (input.parentId !== undefined && !/^[a-f0-9-]{36}$/.test(input.parentId)) throw new Error('原作品 ID 无效')
}
export function creationEngine(engine, { scheme, title, tools }) {
  return {
    ...engine,
    async register(backend, context) {
      await engine.register?.(backend, context)
      const store = new TaskStore(context.dataDir)
      if(supportsWorkflow(scheme))registerWorkflow(backend,store,scheme)
      backend.registerAction('composer.list', async ({query='', offset=0, limit=20}={}) => ({items:(await store.list()).filter(t=>t.status==='succeeded' && String(t.input.title||t.result?.title||'').toLowerCase().includes(query.toLowerCase())).slice(offset,offset+Math.min(limit,50)).map(t=>({title:t.input.title||t.result?.title||title,description:'在主会话中继续修改',ref:{taskId:t.id},scope:'user'}))}))
      backend.registerAction('composer.resolve', async input => {
        if (input.uri) {
          const uri = new URL(input.uri)
          if (uri.protocol !== scheme+':' || uri.search || uri.hash) throw new Error('作品引用无效')
          const parts = uri.pathname.slice(1).split('/'), storeId=parts[0]
          if (!['works','files'].includes(uri.hostname) || (uri.hostname==='works' ? parts.length!==1 : parts.length!==2 || !/^\d{1,4}$/.test(parts[1]))) throw new Error('作品引用无效')
          const task=await store.get(storeId)
          const index=uri.hostname==='works' ? task.result?.previewIndex ?? 0 : Number(parts[1]), file=task.artifacts[index]
          if(task.status!=='succeeded'||!file)throw new Error('作品尚未生成')
          const target=await fs.realpath(file.path), relative=path.relative(await fs.realpath(store.directory(task.id)),target)
          if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative)||(await fs.stat(target)).isDirectory())throw new Error('文件不属于当前作品')
          return {kind:'file',name:file.name,path:target,resourceUri:input.uri,workId:task.result.workId,version:task.result.version,creation:{...(index===task.result.previewIndex?{sourceSha256:task.result.inspection?.sourceSha256}:{}),version:task.result.version,quality:task.result.quality,comparison:task.result.comparison,rendering:task.result.rendering,...(index===task.result.previewIndex?{previewPdfPath:task.result.visualReview?.pdfPath}:{})},...(file.purpose==='comparison'?{presentation:{type:'document-comparison'}}:file.kind==='html'?{presentation:{type:'interactive-html'}}:{})}
        }
        if(!['create','edit','use'].includes(input.intent))throw new Error('请选择创作或继续修改')
        const task=input.ref?.taskId?await store.get(input.ref.taskId):null
        if(input.intent!=='create'&&task?.status!=='succeeded')throw new Error('作品尚未生成')
        return {title:task?.input.title||title,ref:input.ref||{},prompt:`请${task?'继续修改「'+(task.input.title||title)+'」':'使用'+title+'创作'}。`,tools,
          instruction:`读取此 App 的技能，在主会话完成工作。${task?'原任务 ID='+task.id+'；先读取原任务，再传 parentId 创建新版本，保留原文件。':''}成功后调用 moss_present(result.presentation)，回复使用 result.displayMarkdown。实现材料由模型生成，不要求用户填写代码或 JSON。`}
      })
    },
    async execute(input,ctx) {
      const id=path.basename(ctx.directory),store=new TaskStore(ctx.dataDir)
      let version=1,workId=id,parent
      if(input.parentId){parent=await store.get(input.parentId);if(parent.status!=='succeeded')throw new Error('原作品尚未完成');version=(parent.result?.version||1)+1;workId=parent.result?.workId||parent.id}
      const baseline=supportsWorkflow(scheme)?await prepareBaseline(input,parent,ctx):null
      const output=await engine.execute.call(engine,input,ctx)
      if(output.status && output.status!=='succeeded')return output
      const artifacts=output.artifacts||[],name=input.title||output.result?.title||title
      if(!artifacts.length)throw new Error('没有生成作品文件')
      const source=path.join(ctx.directory,'creation-source.json');await fs.writeFile(source,JSON.stringify(input,null,2))
      artifacts.push({name:'创作源文件.json',path:source,kind:'json'})
      const nativeIndex=artifacts.findIndex(a=>officeExtensions.has(path.extname(a.path).toLowerCase()))
      const nativePdfIndex=artifacts.findIndex(a=>a.kind==='pdf')
      let previewIndex=nativeIndex >= 0 ? nativeIndex : nativePdfIndex >= 0 ? nativePdfIndex : output.result?.previewIndex ?? Math.max(0,artifacts.findIndex(a=>a.kind==='html'))
      if((nativeIndex >= 0 || (supportsWorkflow(scheme)&&nativePdfIndex >= 0)) && !output.result?.visualReview){
        const rendered=await renderOfficeFile(artifacts[nativeIndex >= 0 ? nativeIndex : nativePdfIndex].path,path.join(ctx.directory,'office-preview'),ctx)
        artifacts.push(...rendered.files)
        output.result={...output.result,visualReview:rendered.result}
      }
      await engine.finalize?.(input,ctx,output)
      if(supportsWorkflow(scheme))await finishInspection(output,input,ctx,baseline,scheme)

      if(artifacts[previewIndex].kind==='html'&&(await fs.stat(artifacts[previewIndex].path)).size>2*1024**2)throw new Error('预览超过 2 MiB，请缩小内容或图片后重新生成')
      const resourceUri=sessionResourceUri(`${scheme}://works/${id}`,ctx.sessionId),downloads=artifacts.map((a,index)=>({name:a.name,resourceUri:sessionResourceUri(`${scheme}://files/${id}/${index}`,ctx.sessionId),kind:a.kind}))
      const display=artifacts[previewIndex].kind==='html'?'```moss-visualization\n'+JSON.stringify({resource_uri:resourceUri,title:name})+'\n```':`[${name.replace(/[\[\]]/g,'')}](${resourceUri})`
      return {...output,artifacts,result:{...output.result,title:name,workId,version,parentId:input.parentId||null,previewIndex,resourceUri,downloads,
        presentation:{items:[{resource_uri:resourceUri,title:name,role:'primary'},
          ...downloads.flatMap((file,index)=>index!==previewIndex&&file.kind!=='json'&&!artifacts[index].purpose&&file.kind!=='html'?[{resource_uri:file.resourceUri,title:file.name,role:'supporting'}]:[])],mode:'auto'},displayMarkdown:display}}
    },
  }
}
