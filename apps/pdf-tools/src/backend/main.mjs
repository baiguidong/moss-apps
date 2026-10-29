import { pdfWorkflow } from './workflow.mjs'
import { startApp } from '@moss/local-tasks/backend'
import { fileURLToPath } from 'node:url'
import { inspect, validate } from './engine.mjs'
import { resourceUri, present, versionOf } from './presentation.mjs'
startApp({worker:fileURLToPath(new URL('./worker.mjs',import.meta.url)),inspect,validate,
 extraActions:{
  'creation.inspect':(service,input)=>pdfWorkflow(service).invoke('creation.inspect',input),
  'creation.verify':(service,input)=>pdfWorkflow(service).invoke('creation.verify',input),
  'tasks.start':async(service,input,context)=>{if(input.parentId&&!service.state.tasks.some(t=>t.id===input.parentId&&t.status==='succeeded'))throw new Error('原 PDF 任务尚未完成');return service.start(input,context.signal)},
  'workspace.get':async service=>{const view=await service.overview();return {...view,tasks:view.tasks.map(t=>present(t,view.files,view.tasks)),files:view.files.map(f=>({...f,resourceUri:resourceUri(f.id),displayMarkdown:`[${f.name.replace(/[\[\]]/g,'')}](${resourceUri(f.id)})`}))}},
  'tasks.get':async(service,{id})=>{const view=await service.overview(),task=view.tasks.find(t=>t.id===id);if(!task)throw new Error('PDF 任务不存在');return task.status==='succeeded'&&task.outputs.some(id=>view.files.some(f=>f.id===id&&f.kind==='pdf'))?pdfWorkflow(service).get(id):present(task,view.files,view.tasks)},
  'composer.list':async(service,{query='',offset=0,limit=20}={})=>({items:service.state.files.filter(f=>f.kind==='pdf'&&f.name.toLowerCase().includes(query.toLowerCase())).slice(offset,offset+Math.min(limit,50)).map(f=>({title:f.name,ref:{fileId:f.id},scope:'user'}))}),
  'resources.resolve':async(service,input)=>{
   if(!input.uri){if(input.intent==='create')return {title:'PDF 创作',prompt:'请创建一份 PDF。',tools:['pdf_create','pdf_status'],instruction:'读取 PDF 技能，完成后在主会话展示结果。'};const file=input.ref?.fileId?service.file(input.ref.fileId):null;if(!file||!['use','edit'].includes(input.intent))throw new Error('请选择要处理的 PDF');return {title:file.name,ref:input.ref,prompt:`请继续处理 PDF「${file.name}」。`,tools:['pdf_create','pdf_status','pdf_list'],instruction:`当前 PDF 文件 ID=${file.id}。读取 PDF 技能并通过 pdf_create 处理，保留原文件，成功后用 moss_present 展示结果。`}}
   const uri=new URL(input.uri)
   if(uri.protocol==='moss-pdf:'&&uri.hostname==='files'&&!uri.hash&&!uri.search&&/^\/[a-f0-9-]{36}\/\d{1,4}$/.test(uri.pathname)){const [,id,index]=uri.pathname.split('/');return pdfWorkflow(service).resolve(id,Number(index))}
   if(uri.protocol!=='moss-pdf:'||uri.hostname!=='files'||uri.hash||uri.search||!/^\/[a-zA-Z0-9_-]{1,100}$/.test(uri.pathname))throw new Error('PDF 资源引用无效')
   const file=service.file(uri.pathname.slice(1)),task=service.state.tasks.find(t=>t.outputs.includes(file.id)),workflow=task?await pdfWorkflow(service).load(task.id):null;return {kind:'file',name:file.name,path:await service.filePath(file),resourceUri:input.uri,...(task?versionOf(task,service.state.tasks):{}),...(workflow?{creation:{...(input.uri===workflow.result.resourceUri?{sourceSha256:workflow.result.inspection?.sourceSha256}:{}),version:workflow.result.version,quality:workflow.result.quality,comparison:workflow.result.comparison,rendering:workflow.result.rendering}}:{})}
  }
 }})
