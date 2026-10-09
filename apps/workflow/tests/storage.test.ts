import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { withCatalogContext } from '../src/storage/context'
import { createWorkflowDraft, updateWorkflowDraft, getWorkflowCatalogDetail, publishWorkflow } from '../src/engine/catalog'
const definition: any = { version: 3, kind: 'state-machine', meta: { name: 'storage-test', title: '存储验证', description: '验证不可变修订' }, graph: { entry: 'input', nodes: [
  { id: 'input', type: 'start', title: '输入', outputSchema: {} }, { id: 'output', type: 'end', title: '输出', inputSchema: {}, input: [{ target: [], source: { kind: 'node-output', nodeId: 'input' } }] }
], edges: [{source:'input',target:'output'}] } }
test('catalog uses optimistic revisions and preserves immutable earlier definitions', async () => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-revision-'))
  try { await withCatalogContext({dataDir}, async () => {
    const draft=await createWorkflowDraft({definition})
    const updated=await updateWorkflowDraft({workflowId:draft.record.id,baseRevision:1,definition:{...definition,meta:{...definition.meta,title:'新修订'}}})
    expect(updated.record.currentRevision).toBe(2)
    await expect(updateWorkflowDraft({workflowId:draft.record.id,baseRevision:1,definition})).rejects.toThrow()
    expect((await getWorkflowCatalogDetail({workflowId:draft.record.id,revision:1})).revision.definition.meta.title).toBe('存储验证')
  }) } finally { fs.rmSync(dataDir,{recursive:true,force:true}) }
})
