import fs from 'node:fs/promises'
import path from 'node:path'
import { creationEngine, validateTitle, inputFile, safeName, escapeHtml as h, htmlDocument } from '@moss/creation-apps'
import { officeText } from '@moss/creation-apps/office'
import { TaskStore } from '@moss/engine-apps/runtime'
import { finalizeTemplate } from './skill-bundle.mjs'
const extensions=['.docx','.pptx','.xlsx','.csv','.tsv','.md','.txt','.html','.pdf','.png','.jpg','.jpeg','.json']
export function validate(input){validateTitle(input);if(input.skillName!==undefined&&(typeof input.skillName!=='string'||input.skillName.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.skillName)))throw new Error('技能名称需为不超过 64 字符的小写字母、数字和连字符');if(input.skillDescription!==undefined&&(typeof input.skillDescription!=='string'||!input.skillDescription.trim()||input.skillDescription.length>500))throw new Error('技能说明需为 1–500 字');if(!['save','use','update'].includes(input.mode||'save'))throw new Error('不支持的模板操作');if(input.mode==='use'||input.mode==='update'){if(!/^[a-f0-9-]{36}$/.test(input.templateId||''))throw new Error('请选择模板 ID')}else if(!input.sourcePath&&typeof input.content!=='string')throw new Error('请提供参考文件或模板内容');if(input.content&&Buffer.byteLength(input.content)>2*1024**2)throw new Error('模板内容最多 2 MiB')}
const engine={id:'templates',spec:{version:'0.2.1'},validate,finalize:finalizeTemplate,
 async catalog(){return {modes:['save','use','update'],formats:extensions,schema:JSON.parse(await fs.readFile(new URL('../../schemas/start.json',import.meta.url),'utf8'))}},
 async execute(input,ctx){
  validate(input);let reference,kind=input.kind||'text',guidance=input.instructions||'',sourceName='reference.md',skillName=input.skillName,skillDescription=input.skillDescription
  const store=new TaskStore(ctx.dataDir)
  if(input.templateId){const task=await store.get(input.templateId);if(task.status!=='succeeded'||!task.result?.template)throw new Error('模板不可用');const ref=task.artifacts.find(f=>f.name===task.result.template.referenceName);if(!ref)throw new Error('模板参考文件丢失');const real=await fs.realpath(ref.path),relative=path.relative(await fs.realpath(store.directory(task.id)),real);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('模板文件位置无效');reference=await fs.readFile(real);sourceName=path.basename(real);kind=task.result.template.kind;skillName ||= task.result.template.skillName;guidance=input.instructions??task.result.template.instructions
   // Older tasks kept the description in their input/bundle, not template metadata.
   skillDescription ??= task.result.template.skillDescription ?? task.input?.skillDescription ?? task.result.skillBundle?.description
  }
  if(input.sourcePath){const file=await inputFile(input.sourcePath,extensions,40*1024**2);reference=await fs.readFile(file);sourceName='reference'+path.extname(file);kind=({'.docx':'document','.pptx':'presentation','.xlsx':'spreadsheet','.pdf':'pdf','.png':'image','.jpg':'image','.jpeg':'image'}[path.extname(file)]||'text')}
  if(input.content!==undefined){reference=Buffer.from(input.content);sourceName='reference.md';kind='text'}
  if(!reference)throw new Error('缺少模板参考内容')
  const isText=['.md','.txt','.html','.csv','.tsv','.json'].includes(path.extname(sourceName))
  if(input.mode==='use'&&isText){let content=reference.toString('utf8');for(const [key,value]of Object.entries(input.values||{})){if(!/^[\w\u4e00-\u9fff -]{1,80}$/.test(key)||!['string','number','boolean'].includes(typeof value))throw new Error('模板变量无效');content=content.split('{{'+key+'}}').join(String(value))}const missing=content.match(/\{\{[^{}]+\}\}/g);if(missing?.length)throw new Error('模板变量未填写：'+[...new Set(missing)].join('、'));reference=Buffer.from(content)}
  const file=path.join(ctx.directory,input.mode==='use'?safeName(input.title)+path.extname(sourceName):sourceName);await fs.writeFile(file,reference)
  let sample=isText?reference.toString('utf8').slice(0,18000):''
  if(kind==='document'||kind==='presentation')sample=(await officeText(file,kind)).map(p=>p.text).join('\n\n').slice(0,18000)
  const instructions=path.join(ctx.directory,'template.json'),metadata={name:input.title,kind,skillName,skillDescription,instructions:guidance,referenceName:path.basename(file),sourceTemplateId:input.templateId||null,values:input.values||{}}
  await fs.writeFile(instructions,JSON.stringify(metadata,null,2))
  const preview=path.join(ctx.directory,'preview.html');await fs.writeFile(preview,htmlDocument(input.title,`<h1>${h(input.title)}</h1><p>${h(guidance||'在主会话引用这份模板，保留参考材料的结构和风格，按新需求生成内容。')}</p>${kind==='image'?`<img alt="模板参考" src="data:image/${path.extname(file)==='.png'?'png':'jpeg'};base64,${reference.toString('base64')}">`:sample?`<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${h(sample)}</pre>`:`<p>${h(({spreadsheet:'Excel 表格',pdf:'PDF 文档'}[kind]||'参考文件'))}已保留，可在主会话交给对应 App 继续创作。</p>`}`))
  return {artifacts:[{name:path.basename(file),path:file,kind:kind==='pdf'?'pdf':'document'},{name:'模板说明',path:preview,kind:'html'},{name:'模板参数.json',path:instructions,kind:'json'}],result:{previewIndex:1,template:metadata,referencePath:file,nextApp:{document:'moss.document',spreadsheet:'moss.spreadsheets',presentation:'moss.presentations',pdf:'moss.pdf'}[kind]||null},message:input.mode==='use'?'模板已应用，参考文件可交给对应 App 创作':'模板已保存'}
 }}
export default creationEngine(engine,{scheme:'moss-templates',title:'模板',tools:['template_create','template_status','template_list']})
