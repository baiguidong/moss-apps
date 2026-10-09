import { test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { composerActions } from '../src/backend/composer'
import { updateRunSnapshot, readRunSnapshot } from '../src/backend/snapshot'
import { withCatalogContext } from '../src/storage/context'
import * as catalog from '../src/engine/catalog'

const definition:any={version:3,kind:'state-machine',meta:{name:'selected-flow',title:'选择验证',description:'测试'},graph:{entry:'start',nodes:[{id:'start',type:'start',title:'开始',outputSchema:{}},{id:'end',type:'end',title:'结束',inputSchema:{},input:[]}],edges:[{source:'start',target:'end'}]}}
test('resource discovery excludes drafts and rejects a changed published revision',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-composer-'))
  try { await withCatalogContext({dataDir},async()=>{
    const created=await catalog.createWorkflowDraft({definition})
    expect(await composerActions['composer.list']({})).toHaveLength(0)
    await catalog.publishWorkflow({workflowId:created.record.id})
    const [entry]=await composerActions['composer.list']({query:'选择'})
    const context=await composerActions['composer.resolve']({intent:'use',ref:entry.ref})
    expect(context.tools).toContain('workflow_run')
    expect(context.ref).toEqual({workflowId:created.record.id,revision:1})
    await catalog.updateWorkflowDraft({workflowId:created.record.id,baseRevision:1,definition})
    expect((await composerActions['composer.resolve']({intent:'use',ref:entry.ref})).ref.revision).toBe(1)
    await catalog.publishWorkflow({workflowId:created.record.id})
    await expect(composerActions['composer.resolve']({intent:'use',ref:entry.ref})).rejects.toThrow('版本')
    expect((await composerActions['composer.resolve']({intent:'create'})).prompt).toContain('需求')
  }) } finally { fs.rmSync(dataDir,{recursive:true,force:true}) }
})
test('snapshot survives a rolling feed, parallel instances, loop traversals and persistence',()=>{
  let run:any={status:'running',sequence:0,events:[]}
  const emit=(event:any)=>{updateRunSnapshot(run,{timestamp:1,...event});run.sequence++}
  for(let i=0;i<40;i++) emit({type:'workflow_node',nodeId:`node-${i}`,instanceId:`node-${i}`,state:'completed',sequence:i})
  emit({type:'workflow_node',nodeId:'each',instanceId:'each/1',state:'running'})
  emit({type:'workflow_node',nodeId:'each',instanceId:'each/2',state:'completed'})
  emit({type:'workflow_edge',edgeId:'loop',state:'traversed'})
  emit({type:'workflow_edge',edgeId:'loop',state:'skipped'})
  emit({type:'workflow_node',nodeId:'node-0',instanceId:'nested/node-0',state:'failed',workflowDepth:1})
  run=JSON.parse(JSON.stringify(run)); const state=readRunSnapshot(run)
  expect(state.nodes).toHaveLength(41)
  expect(state.nodes.find((n:any)=>n.nodeId==='node-0').state).toBe('completed')
  expect(state.nodes.find((n:any)=>n.nodeId==='each')).toMatchObject({state:'running',executionCount:2})
  expect(state.edges[0].state).toBe('traversed')
  run.status='interrupted';expect(readRunSnapshot(run).nodes.find((n:any)=>n.nodeId==='each').state).toBe('interrupted')
})
