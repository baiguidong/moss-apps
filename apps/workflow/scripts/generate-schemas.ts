import fs from 'node:fs'
import { z } from 'zod'
import { workflowDefinitionAuthoringSchema } from '../src/engine/definition'
import { getWorkflowAuthoringPrompt } from '../src/backend/authoring-prompt'
const read = (name: string) => JSON.parse(fs.readFileSync(`schemas/${name}.json`, 'utf8'))
const write = (name: string,value: any) => fs.writeFileSync(`schemas/${name}.json`,JSON.stringify(value,null,2)+'\n')
const definition: any = z.toJSONSchema(workflowDefinitionAuthoringSchema,{target:'draft-7',unrepresentable:'any',reused:'ref'})
delete definition.$schema
const definitions = definition.definitions
delete definition.definitions
for(const name of ['catalog.create','catalog.edit','run.start']) {
  const schema = read(name); schema.properties.definition = definition; schema.definitions = definitions; if(name !== 'run.start') schema.description = getWorkflowAuthoringPrompt()
  if (name === 'run.start') {
    for(const key of ['name','definitionPath','submissionKey']) schema.properties[key] = {type:'string',minLength:1,maxLength:512}
    schema.oneOf = ['workflowId','name','definitionPath','definition'].map(key => ({required:[key]}))
  }
  write(name,schema)
}
for(const name of ['catalog.list','run.list']) {
  const schema = read(name); schema.properties.offset = {type:'integer',minimum:0}; schema.properties.limit = {type:'integer',minimum:1,maximum:20};write(name,schema)
}
write('resource.read',{type:'object',additionalProperties:false,properties:{resourceRef:{type:'string',pattern:'^[a-f0-9]{64}$'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:32000}},required:['resourceRef']})
write('run.export',{type:'object',properties:{runId:{type:'string',minLength:1}},required:['runId'],additionalProperties:false})
const groups: Record<string,Record<string,string>> = {
  workflow_read:{list:'catalog.list',get:'catalog.get',runs:'run.list',run:'run.get',events:'run.events',export:'run.export',resource:'resource.read'},
  workflow_manage:{publish:'catalog.publish',duplicate:'catalog.duplicate',restore:'catalog.restore'},
  workflow_run:{start:'run.start',cancel:'run.cancel',resume:'run.resume'},
  workflow_remove:{unpublish:'catalog.unpublish',archive:'catalog.archive',delete:'catalog.delete'},
}
for(const [name,operations] of Object.entries(groups)) {
  const branches=Object.entries(operations).map(([operation,action])=>{const schema=read(action);return {...schema,properties:{...schema.properties,operation:{const:operation,type:'string'}},required:['operation',...(schema.required??[])]}})
  write(name,{type:'object',definitions,properties:{...Object.assign({},...branches.map(b=>b.properties)),operation:{type:'string',enum:Object.keys(operations)}},required:['operation'],additionalProperties:false,description:branches.map(b=>`${b.properties.operation.const}: required ${b.required.join(', ')}`).join('; ')})
}
const manifest = JSON.parse(fs.readFileSync('app.moss.json','utf8'));manifest.hostApi='^2.8.0'
manifest.backend.actions = manifest.backend.actions.filter((a:any)=>!['templates.list','history.list','history.get','commands.list'].includes(a.name))
manifest.contributes.resourceProviders=[{id:'workflows',title:'工作流',schemes:['moss-workflow'],resolveAction:'composer.resolve',listAction:'composer.list'}]
write('composer.list',{type:'object',properties:{query:{type:'string',maxLength:512},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false})
write('composer.resolve',{type:'object',properties:{intent:{enum:['create','edit','use']},ref:{type:'object',properties:{workflowId:{type:'string'},revision:{type:'integer',minimum:1}},required:['workflowId','revision'],additionalProperties:false}},required:['intent'],additionalProperties:false})
for (const name of ['composer.list','composer.resolve','run.export','resource.read', ...Object.keys(groups)]) if (!manifest.backend.actions.some((a:any)=>a.name===name)) manifest.backend.actions.push({name,inputSchema:`schemas/${name}.json`,timeoutMs:30000})
manifest.contributes.commands = []
manifest.contributes.tools = [
  ['workflow_read','读取工作流','read','workflow_read','读取目录、定义、运行和分块资源。列表每页最多20条，使用offset翻页。大结果包含resourceRef，operation=resource分块读取。'],
  ['workflow_create','创建工作流','write','catalog.create','创建 Definition v3 草稿；完整创作规则和节点结构见输入 Schema。按用户要求设计流程，显式绑定数据，不执行节点。默认 user 范围；只有明确要求时使用 project。代码和 JSON Schema 会在保存前校验。'],
  ['workflow_edit','编辑工作流','write','catalog.edit','编辑 Definition v3 草稿；完整创作规则见输入 Schema。baseRevision 必须等于当前版本；只修改用户要求的阶段，不因运行失败自行改写流程。'],
  ['workflow_manage','管理工作流','write','workflow_manage','发布、复制、恢复归档。publish 发布当前草稿；不会执行。'],
  ['workflow_run','运行工作流','write','workflow_run','start/cancel/resume。仅用户要求执行时启动。正式运行只接受当前已发布修订；test可运行指定草稿。来源四选一：workflowId、name、definitionPath、definition。文件/内联是独立快照。返回后台runId，无需循环等待。重试同一次提交时复用submissionKey；新运行使用新key。Agent继承普通会话的模型和权限。'],
  ['workflow_remove','移除工作流','destructive','workflow_remove','取消发布、归档或永久删除；按照用户要求执行。'],
].map(([id,title,effect,action,description])=>({id,title,effect,action,description,inputSchema:`schemas/${action}.json`}))
fs.writeFileSync('app.moss.json',JSON.stringify(manifest,null,2)+'\n')
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));pkg.version=manifest.version;fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n')
