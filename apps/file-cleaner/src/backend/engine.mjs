import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureBinary, existingPaths, run, argv } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with { type:'json' }
import catalog from '../../resources/catalog.json' with { type:'json' }
import ffmpeg from '../../resources/ffmpeg.json' with { type:'json' }
import ffprobe from '../../resources/ffprobe.json' with { type:'json' }

const managed = new Set(['directories','compact-file-to-save','pretty-file-to-save','file-to-save','help','ignore-error-code-on-found'])
const writes = new Set(['delete-method','delete-files','fix-names','fix-extensions','fix-exif','fix-videos','overwrite-original','override-file'])
function options(values, definitions) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('参数格式错误')
  const result=[]
  for(const [key,value] of Object.entries(values)) {
    const option=definitions.find(o=>o.key===key)
    if(!option || managed.has(key)) throw new Error(`不支持或由 App 管理的参数：${key}`)
    if(value===false || value==='' || value==null)continue
    if(!option.value) {if(value!==true)throw new Error(`${key} 必须是布尔值`);result.push('--'+key)}
    else for(const entry of Array.isArray(value)?value:[value]) { if(typeof entry!=='string')throw new Error(`${key} 必须是字符串`);result.push('--'+key,entry) }
  }
  return argv(result)
}
function alters(input, definitions) {
  const values={...input.options,...input.suboptions}
  if(Object.entries(values).some(([k,v])=>writes.has(k) && v && String(v).toUpperCase()!=='NONE'))return true
  return (input.extraArgs||[]).some(arg=>definitions.some(o=>writes.has(o.key) && (arg==='--'+o.key || arg.startsWith('--'+o.key+'=') || (o.short && (arg==='-'+o.short || arg.startsWith('-'+o.short))))))
}
export async function buildArgs(input, directory) {
  const command=catalog.commands.find(c=>c.id===input.command)
  if(!command)throw new Error('请选择扫描类别')
  const paths=await existingPaths(input.paths,'directory')
  const sub=command.subcommands?.find(s=>s.id===input.subcommand)
  if(command.subcommands&&!sub)throw new Error('请选择视频优化方式')
  const definitions=[...command.options,...(sub?.options||[])]
  if(alters(input,definitions)&&input.confirmChanges!==true)throw new Error('此操作会修改文件，请先预演并确认处理范围')
  const extra=argv(input.extraArgs||[])
  for (let i=0;i<extra.length;i++) {
    const match=/^(?:--([a-z0-9-]+)(?:=(.*))?|-([a-zA-Z]))$/.exec(extra[i])
    const option=match&&definitions.find(o=>match[1]?o.key===match[1]:o.short===match[3])
    if (!option || managed.has(option.key)) throw new Error(`高级参数无效：${extra[i]}`)
    if(option.value && match[2]===undefined) { if(typeof extra[++i]!=='string')throw new Error('高级参数缺少值') }
  }
  // Expert args may adjust upstream behavior, but cannot redirect managed reports.
  for(const arg of extra) if(['-C','-p','-f','-d','--'].includes(arg)||/^(--(?:directories|compact-file-to-save|pretty-file-to-save|file-to-save|help))(=|$)/.test(arg)||/^-[Cpf d].+/.test(arg))throw new Error('高级参数不能覆盖目录或结果文件；请使用对应表单')
  const args=[command.id,...paths.flatMap(p=>['--directories',p]),...options(input.options||{},command.options),'-W','-C',path.join(directory,'results.json'),'-f',path.join(directory,'results.txt')]
  if(sub)args.push(sub.id,...options(input.suboptions||{},sub.options))
  args.push(...extra)
  return {args,paths}
}
function collect(value, groups=[], location='结果') {
  if(Array.isArray(value)&&value.length&&value.every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.path==='string'))groups.push({name:location,files:value})
  else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))collect(child,groups,`${location} / ${key}`)
  return groups
}
export default {
  id:'czkawka',spec,
  async catalog({dataDir,prepare}) {if(prepare)await ensureBinary(spec,dataDir);return {...catalog,version:spec.version}},
  async validate(input) {await buildArgs(input,'/tmp/moss-output-validation')},
  async execute(input,ctx) {
    await ctx.progress('准备 Czkawka 引擎')
    const binary=await ensureBinary(spec,ctx.dataDir,ctx.signal), {args,paths}=await buildArgs(input,ctx.directory)
    let env
    if(['video','video-optimizer'].includes(input.command)) {
      await ctx.progress('准备视频运行依赖')
      const media=await Promise.all([ffmpeg,ffprobe].map(spec=>ensureBinary(spec,ctx.dataDir,ctx.signal)))
      env={PATH:[...media.map(file=>path.dirname(file)),process.env.PATH||''].join(path.delimiter)}
    }
    await ctx.progress('正在扫描目录')
    await ctx.record?.({argv:args})
    const execution=await run(binary,args,{signal:ctx.signal,log:ctx.log,env})
    const file=path.join(ctx.directory,'results.json'), stat=await fs.stat(file)
    if(stat.size>16*1024*1024)throw new Error('扫描报告较大，请缩小目录范围')
    const result=JSON.parse(await fs.readFile(file,'utf8'))
    const groups=collect(result), files=groups.flatMap(g=>g.files)
    // Flat tool results (large/empty files) can be one object rather than groups.
    if(!groups.length&&result&&typeof result==='object') {
      const walk=value=>{if(value&&typeof value==='object'){if(typeof value.path==='string')files.push(value);else Object.values(value).forEach(walk)}};walk(result)
      if(files.length)groups.push({name:'扫描结果',files})
    }
    const artifacts=[{name:'扫描报告.json',path:file,kind:'json'},{name:'扫描报告.txt',path:path.join(ctx.directory,'results.txt'),kind:'text'}]
    for(const file of files.filter(f=>/\.(png|jpe?g|webp)$/i.test(f.path)).slice(0,80)) {
      const real=await fs.realpath(file.path).catch(()=>null)
      if(real&&paths.some(root=>real.startsWith(root+path.sep))) {file.previewIndex=artifacts.length;artifacts.push({name:path.basename(real),path:real,kind:'image'})}
    }
    return {message:`已完成：${groups.length} 组，${files.length} 个匹配项`,readRoots:paths,argv:args,artifacts,
      result:{groups:groups.slice(0,100).map(g=>({...g,files:g.files.slice(0,500)})),groupCount:groups.length,fileCount:files.length,bytes:files.reduce((sum,f)=>sum+(Number(f.size)||0),0),truncated:groups.length>100||groups.some(g=>g.files.length>500)},warnings:execution.stderr}
  },
}
