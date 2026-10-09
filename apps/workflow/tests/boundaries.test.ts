import {test,expect} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { RunManager } from '../src/backend/runs'
import { Resources } from '../src/backend/resources'
import { resolveDefinition, validateDefinition, resolveChildren } from '../src/backend/validation'
import { withCatalogContext } from '../src/storage/context'
import * as catalog from '../src/engine/catalog'
export const definition:any={version:3,kind:'state-machine',meta:{name:'boundary-flow',title:'边界验证',description:'验证'},graph:{entry:'start',nodes:[{id:'start',type:'start',title:'输入',outputSchema:{}},{id:'code',type:'code',title:'计算',language:'javascript',outputSchema:{},script:'return 42'},{id:'end',type:'end',title:'输出',inputSchema:{},input:[{target:[],source:{kind:'node-output',nodeId:'code'}}]}],edges:[{source:'start',target:'code'},{source:'code',target:'end'}]}}
test('submission intent survives host acceptance failure and retry/restart without new task',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-idempotency-'));let first=true;const keys=new Set();let launches=0
 const host={request:async(_p:any,_m:any,input:any)=>{keys.add(input.idempotencyKey);if(first){first=false;throw new Error('lost response')}return {id:'task',scopeRef:'scope',status:'running'}}}
 let manager=new RunManager(directory,host,()=>{});manager.launch=()=>{launches++}
 try {
  await expect(manager.start({definition},'same-request')).rejects.toThrow('lost response')
  clearInterval(manager.completionTimer)
  manager=new RunManager(directory,host,()=>{});manager.launch=()=>{launches++}
  const run=await manager.start({definition},'same-request')
  expect((await manager.start({definition},'same-request')).id).toBe(run.id)
  await expect(manager.start({definition,args:{changed:true}},'same-request')).rejects.toThrow('conflict')
  expect(keys.size).toBe(1);expect(launches).toBe(1)
 }finally{await manager.close();fs.rmSync(directory,{recursive:true,force:true})}
})
test('UTF8/escaped large results stay bounded and chunks reconstruct exactly',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-resource-'))
 try {const resources=new Resources(directory),value={text:'中文😀\u0000'.repeat(200000)};const preview=resources.bound(value)
 expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(32768)
 let text='',offset=0;while(true){const chunk=resources.read({resourceRef:preview.resourceRef,offset});expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(1024*1024);text+=chunk.text;if(chunk.nextOffset===null)break;offset=chunk.nextOffset}
 expect(JSON.parse(text)).toEqual(value)
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})
test('compile checks, formal revisions, source exclusivity and project precedence',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-sources-')),cwd=path.join(root,'project');fs.mkdirSync(cwd)
 try{await withCatalogContext({dataDir:path.join(root,'data'),cwd},async()=>{
 const invalid=structuredClone(definition);invalid.graph.nodes[1].script='return input.';expect(()=>validateDefinition(invalid)).toThrow()
 const user=await catalog.createWorkflowDraft({definition});await expect(resolveDefinition({workflowId:user.record.id,revision:1})).rejects.toThrow('发布')
 await catalog.publishWorkflow({workflowId:user.record.id});await catalog.updateWorkflowDraft({workflowId:user.record.id,baseRevision:1,definition})
 await expect(resolveDefinition({workflowId:user.record.id,revision:2})).rejects.toThrow('发布')
 expect((await resolveDefinition({workflowId:user.record.id,revision:2,mode:'test'})).revision).toBe(2)
 const project=await catalog.createWorkflowDraft({definition,scope:'project'});await catalog.publishWorkflow({workflowId:project.record.id});expect((await resolveDefinition({name:definition.meta.name})).workflowId).toBe(project.record.id)
 await expect(resolveDefinition({definition,workflowId:user.record.id})).rejects.toThrow('exactly one')
 const file=path.join(cwd,'one.json');fs.writeFileSync(file,JSON.stringify(definition));expect((await resolveDefinition({definitionPath:'one.json',cwd})).definition).toEqual(definition)
 await catalog.archiveWorkflow({workflowId:project.record.id});await expect(resolveDefinition({workflowId:project.record.id,mode:'test'})).rejects.toThrow('Archived')
 })}finally{fs.rmSync(root,{recursive:true,force:true})}
})
