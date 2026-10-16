import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureBinary, existingPaths, run, argv } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with {type:'json'}
import pdfEngine from '../../resources/pdf-engine.json' with {type:'json'}
import catalog from '../../resources/catalog.json' with {type:'json'}

const reserved=new Set(['from','read','to','write','output','log','extract-media','help','version'])
const ext={gfm:'md',commonmark:'md',commonmark_x:'md',markdown:'md',markdown_strict:'md',markdown_phpextra:'md',markdown_github:'md',markdown_mmd:'md',html5:'html',html4:'html',epub2:'epub',epub3:'epub',plain:'txt',latex:'tex',beamer:'tex',revealjs:'html',s5:'html',slidy:'html',dzslides:'html'}
export async function buildArgs(input,directory) {
  const paths=await existingPaths(input.paths)
  const from=input.from||'', to=input.to||'html5'
  if(from&&!catalog.inputFormats.includes(from.split(/[+-]/)[0]))throw new Error('不支持的输入格式')
  if(to!=='pdf'&&!catalog.outputFormats.includes(to.split(/[+-]/)[0]))throw new Error('不支持的输出格式')
  const stem=paths.length===1?path.basename(paths[0],path.extname(paths[0])):'合并文档'
  const output=path.join(directory,stem+'.'+(ext[to.split(/[+-]/)[0]]||to.split(/[+-]/)[0]))
  const args=[]
  const entries=input.options||{}
  if(typeof entries!=='object'||Array.isArray(entries))throw new Error('选项必须是对象')
  for(const [key,value]of Object.entries(entries)) {
    const option=catalog.options.find(o=>o.key===key)
    if(!option||reserved.has(key)||key.startsWith('list-')&& !['list-tables','list-of-figures','list-of-tables'].includes(key)||key.startsWith('print-'))throw new Error(`请通过信息查询使用 ${key}，或检查参数名称`)
    if(value===''||value==null||value===false&&!option.optional)continue
    if(!option.value){if(typeof value!=='boolean')throw new Error(`${key} 必须是布尔值`);args.push('--'+key+(option.optional?'='+value:''))}
    else if(option.optional&&value===true)args.push('--'+key)
    else for(const item of Array.isArray(value)?value:[value]) {if(typeof item!=='string')throw new Error(`${key} 必须是字符串`);args.push('--'+key+'='+item)}
  }
  const extra=argv(input.extraArgs||[])
  if(extra.some(x=>/^--(?:output|log|extract-media)(=|$)/.test(x)||/^-o/.test(x)||x==='--'))throw new Error('高级参数不能覆盖输出位置；请使用表单并保留 App 结果目录')
  args.push(...extra)
  if(input.extractMedia||entries.defaults)args.push('--extract-media',path.join(directory,'media'))
  if(from)args.push('--from',from)
  if(to!=='pdf')args.push('--to',to)
  args.push('--output',output,'--log',path.join(directory,'pandoc-log.json'),...paths)
  return {args,paths,output,to}
}
export default {
  id:'pandoc',spec,
  async catalog({dataDir,prepare}){if(prepare)await ensureBinary(spec,dataDir);return {...catalog,version:spec.version}},
  async validate(input){
    if(input.mode==='inspect') {if(!/^(list-(input-formats|output-formats|extensions|highlight-languages|highlight-styles)|print-(default-template|default-data-file|highlight-style)|version|help)$/.test(input.query||''))throw new Error('不支持的信息查询');return}
    await buildArgs(input,'/tmp/moss-output-validation')
  },
  async execute(input,ctx){
    if(input.mode==='batch' && input.paths?.length>1) {
      const artifacts=[],files=[]
      for(let i=0;i<input.paths.length;i++) {
        ctx.signal.throwIfAborted()
        const directory=path.join(ctx.directory,`batch-${i+1}`);await fs.mkdir(directory,{recursive:true})
        try {const result=await this.execute({...input,mode:'merge',paths:[input.paths[i]]},{...ctx,directory});artifacts.push(...result.artifacts.map(file=>({...file,name:`${path.basename(input.paths[i])} / ${file.name}`})));files.push({input:input.paths[i],status:'succeeded',argv:result.argv})}
        catch(error){if(ctx.signal.aborted)throw error;files.push({input:input.paths[i],status:'failed',error:error.message})}
      }
      const failed=files.filter(file=>file.status==='failed').length
      return {status:failed===files.length?'failed':failed?'partial':'succeeded',artifacts,result:{files},message:`批量转换：${files.length-failed} 成功，${failed} 失败`}
    }
    await ctx.progress('准备 Pandoc 引擎');const binary=await ensureBinary(spec,ctx.dataDir,ctx.signal)
    if(input.mode==='inspect') {
      const args=['--'+input.query+(input.value?'='+input.value:'')],r=await run(binary,args,{signal:ctx.signal,log:ctx.log})
      const file=path.join(ctx.directory,'information.txt');await fs.writeFile(file,r.stdout)
      return {argv:args,message:'查询完成',result:{text:r.stdout},artifacts:[{name:'查询结果.txt',path:file,kind:'text'}]}
    }
    const {args,paths,output,to}=await buildArgs(input,ctx.directory)
    if (to === 'pdf' && !args.some(arg => /^--pdf-engine(?:=|$)/.test(arg))) args.unshift('--pdf-engine=' + await ensureBinary(pdfEngine, ctx.dataDir, ctx.signal))
    await ctx.progress('正在转换文档'); await ctx.record?.({argv:args})
    const r=await run(binary,args,{cwd:path.dirname(paths[0]),signal:ctx.signal,log:ctx.log})
    if(!(await fs.stat(output)).isFile())throw new Error('引擎未生成文档')
    const artifacts=[{name:path.basename(output),path:output,kind:to==='pdf'?'pdf':'document'}]
    let previewError=''
    const readFormat={docx:'docx',epub:'epub',epub2:'epub',epub3:'epub',html:'html',html5:'html',html4:'html',gfm:'gfm',commonmark:'commonmark',markdown:'markdown',odt:'odt',rst:'rst',org:'org',rtf:'rtf',typst:'typst'}[to]
    if(readFormat){
      try {
        const preview=path.join(ctx.directory,'preview.html')
        await run(binary,[output,'--from',readFormat,'--to','html5','--standalone','--embed-resources','--metadata','title=文档内容预览','--output',preview],{cwd:path.dirname(paths[0]),signal:ctx.signal,log:ctx.log})
        artifacts.push({name:'内容预览',path:preview,kind:'html'})
      }catch(error){if(ctx.signal.aborted)throw error;previewError=error.message}
    } else if(!['docx','pptx','odt','epub','epub2','epub3','pdf','chunkedhtml'].includes(to))artifacts[0].kind='text'
    const media=path.join(ctx.directory,'media')
    for(const entry of await fs.readdir(media,{recursive:true,withFileTypes:true}).catch(()=>[])) {
      if(entry.isFile()) {const file=path.join(entry.parentPath,entry.name);artifacts.push({name:'媒体 / '+path.relative(media,file),path:file,kind:/\.(png|jpe?g|webp|gif)$/i.test(file)?'image':'document'})}
    }
    const log=path.join(ctx.directory,'pandoc-log.json');if(await fs.stat(log).catch(()=>null))artifacts.push({name:'转换日志.json',path:log,kind:'json'})
    return {argv:args,artifacts,result:{format:to,size:(await fs.stat(output)).size,previewError},message:'文档已生成',warnings:r.stderr}
  },
}
