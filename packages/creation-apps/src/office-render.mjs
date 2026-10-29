import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { run, hash, atomic } from '@moss/engine-apps/runtime'

export const officeExtensions = new Set(['.docx','.doc','.odt','.rtf','.pptx','.ppt','.odp','.xlsx','.xls','.ods'])
export const DEFAULT_RENDER_BATCH = 8
const sameFile = async (left, right) => typeof left === 'string' && await Promise.all([fs.realpath(left), fs.realpath(right)]).then(([a,b])=>a===b,()=>false)
async function executable(name, overrides, candidates = []) {
  candidates = overrides !== undefined ? (overrides ? [overrides] : []) : [...candidates, ...(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name + (process.platform === 'win32' ? '.exe' : '')))]
  for (const candidate of candidates) { try { await fs.access(candidate, constants.X_OK); return candidate } catch {} }
  return null
}
export function renderingSummary(visual) {
  if (!visual) return undefined
  return {status:visual.status,renderedPages:visual.pages?.length||0,totalPages:visual.pageCount,nextPage:visual.nextPage||null,batchSize:DEFAULT_RENDER_BATCH,reason:visual.reason}
}
// Each completed page is durable. A new request resumes missing pages without
// repeating conversion or discarding pages after a timeout/process restart.
export async function renderOfficeFile(source, directory, { signal, log, progress, maxPages = DEFAULT_RENDER_BATCH, startPage, executables = {}, pageTimeoutMs = 30000 } = {}) {
  const ext = path.extname(source).toLowerCase()
  if (!officeExtensions.has(ext) && ext !== '.pdf') throw new Error('不支持的页面渲染格式')
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20 || (startPage !== undefined && (!Number.isInteger(startPage) || startPage < 1))) throw new Error('每批生成 1–20 页，起始页从 1 开始')
  const files = [], result = { status:'unavailable',sourcePath:source,visuallyVerified:false,pages:[],pageCount:null,directory }
  let temporary, sourceHash
  let manifest=path.join(directory,'render-state.json')
  const command=async (tool,args,timeout=120000,extra={})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('本批页面生成超时，可继续生成剩余页')),timeout)
    try{return await run(tool,args,{signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,log,maxBytes:1024*1024,...extra})}finally{clearTimeout(timer)}
  }
  const summarize=()=>{
    result.pages.sort((a,b)=>a.page-b.page)
    const ready=new Set(result.pages.map(p=>p.page));result.nextPage=null
    for(let i=1;i<=result.pageCount;i++)if(!ready.has(i)){result.nextPage=i;break}
    if(result.pageCount)result.status=result.nextPage?'partial':'rendered'
    result.reason=result.nextPage?`已生成 ${result.pages.length}/${result.pageCount} 页核验图片；可从第 ${result.nextPage} 页继续。`:'页面已渲染，尚需模型逐页查看图片后才能判断排版。'
  }
  const save=()=>atomic(manifest,{...result,sourceSha256:sourceHash})
  try {
    signal?.throwIfAborted();sourceHash=await hash(source);result.sourceSha256=sourceHash
    await fs.mkdir(directory,{recursive:true})
    directory=await fs.realpath(directory);result.directory=directory
    manifest=path.join(directory,'render-state.json')
    source=await fs.realpath(source);result.sourcePath=source
    const saved=await fs.readFile(manifest,'utf8').then(JSON.parse,()=>null)
    if(saved&&saved.sourceSha256!==sourceHash)throw new Error('原文件已变化，不能复用旧页图；请重新读取为新版本')
    let pdf=ext==='.pdf'?source:path.join(directory,'pages.pdf')
    const reusable=await sameFile(saved?.pdfPath,pdf)&&await fs.stat(pdf).then(s=>s.isFile()&&s.size>0,()=>false)
    if(ext!=='.pdf'&&!reusable){
      const soffice=await executable('soffice',executables.soffice,['/Applications/LibreOffice.app/Contents/MacOS/soffice','C:\\Program Files\\LibreOffice\\program\\soffice.exe','C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'])
      if(!soffice){result.reason='未安装 LibreOffice，已保留原件；安装后可渲染并核验页面。';return {files,result}}
      await progress?.('正在转换 Office 页面，随后先生成首批核验图片')
      temporary=await fs.mkdtemp(path.join(os.tmpdir(),'moss-office-render-'))
      const input=path.join(temporary,'source'+ext);await fs.copyFile(source,input)
      await command(soffice,['-env:UserInstallation='+pathToFileURL(path.join(temporary,'profile')).href,'--headless','--norestore','--nofirststartwizard','--convert-to','pdf','--outdir',temporary,input])
      const converted=path.join(temporary,'source.pdf'),header=await fs.open(converted,'r')
      try{const bytes=Buffer.alloc(5);await header.read(bytes,0,5,0);if(bytes.toString()!=='%PDF-')throw new Error('页面转换没有生成有效 PDF')}finally{await header.close()}
      if(await hash(source)!==sourceHash)throw new Error('原文件在渲染期间变化，请重新生成预览')
      await fs.copyFile(converted,pdf)
    }
    result.pdfPath=pdf;result.status='pdf-only'
    if(ext!=='.pdf')files.push({name:'页面版式.pdf',path:pdf,kind:'pdf',purpose:'render'})
    if(!reusable)await save()
    const [ppm,info]=await Promise.all([
      executable('pdftoppm',executables.pdftoppm,['/opt/homebrew/bin/pdftoppm','/usr/local/bin/pdftoppm']),
      executable('pdfinfo',executables.pdfinfo,['/opt/homebrew/bin/pdfinfo','/usr/local/bin/pdfinfo']),
    ])
    if(!ppm||!info){result.reason='页面 PDF 已生成；安装 Poppler 后可继续生成核验页图。';await save();return {files,result}}
    if(reusable&&Number.isInteger(saved.pageCount)&&saved.pageCount>0)result.pageCount=saved.pageCount
    else {const metadata=await command(info,[pdf],30000,{env:{LC_ALL:'C'}});result.pageCount=Number(/^Pages:\s+(\d+)/m.exec(metadata.stdout)?.[1])}
    if(!Number.isInteger(result.pageCount)||result.pageCount<1)throw new Error('无法读取 PDF 页数')
    for(const item of saved?.pages||[]){
      const expected=path.join(directory,`page-${item.page}.png`)
      if(Number.isInteger(item.page)&&item.page>=1&&item.page<=result.pageCount&&await sameFile(item.path,expected)&&await fs.stat(expected).then(s=>s.size>0,()=>false))result.pages.push({page:item.page,path:expected})
    }
    summarize();await save()
    const first=startPage??result.nextPage
    if(first&&first>result.pageCount)throw new Error(`第 ${first} 页不存在，文件共 ${result.pageCount} 页`)
    const ready=new Set(result.pages.map(p=>p.page)),deadline=Date.now()+45000
    for(let page=first;page&&page<=Math.min(first+maxPages-1,result.pageCount);page++){
      if(ready.has(page))continue
      if(Date.now()>=deadline)throw new Error('本批已达到时间上限，可继续生成剩余页')
      signal?.throwIfAborted();await progress?.(`正在生成第 ${page}/${result.pageCount} 页核验图片（已有 ${result.pages.length} 页）`)
      const prefix=path.join(directory,`pending-${page}`),target=path.join(directory,`page-${page}.png`)
      await fs.rm(prefix+'.png',{force:true})
      try{
        await command(ppm,['-f',String(page),'-l',String(page),'-singlefile','-png','-scale-to','1500',pdf,prefix],Math.max(1,Math.min(pageTimeoutMs,deadline-Date.now())))
        if(!(await fs.stat(prefix+'.png')).size)throw new Error('页面图片为空')
        if(await hash(source)!==sourceHash)throw new Error('原文件在渲染期间变化，请重新读取')
        await fs.rename(prefix+'.png',target)
      }finally{await fs.rm(prefix+'.png',{force:true}).catch(()=>{})}
      result.pages.push({page,path:target});summarize();await save()
    }
    for(const item of result.pages)files.push({name:`第 ${item.page} 页.png`,path:item.path,kind:'image',purpose:'render',page:item.page})
    return {files,result}
  } catch(error) {
    signal?.throwIfAborted()
    // Persisted pages are retained, but never associate old pages with a new source.
    if(sourceHash&&result.pages.length&&await hash(source).catch(()=>null)===sourceHash){summarize();result.reason+=` ${String(error.message||error)}`;await save().catch(()=>{})}
    else {result.status='failed';result.reason=String(error.message||error)}
    for(const item of result.pages)if(!files.some(f=>f.path===item.path))files.push({name:`第 ${item.page} 页.png`,path:item.path,kind:'image',purpose:'render',page:item.page})
    return {files,result}
  } finally {if(temporary)await fs.rm(temporary,{recursive:true,force:true,maxRetries:3}).catch(()=>{})}
}
