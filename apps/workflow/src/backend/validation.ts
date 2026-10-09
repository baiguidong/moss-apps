import fs from 'node:fs'
import path from 'node:path'
import { getWorkflowCatalogDetail, listWorkflowCatalog } from '../engine/catalog'
import { prepareWorkflowDefinition } from '../engine/runtime'
import { walkWorkflowNodes } from '../engine/definition'
export function validateDefinition(definition: any) {
  const prepared = prepareWorkflowDefinition(definition)
  if (!prepared.ok) throw new Error(prepared.error)
  return definition
}
export async function resolveDefinition(input: any) {
  if (['workflowId','name','definitionPath','definition'].filter(key => input[key] !== undefined).length !== 1) throw new Error('Provide exactly one workflow source')
  let workflowId = input.workflowId, definition = input.definition, revision: number | undefined
  if (input.name) {
    const entries = await listWorkflowCatalog({cwd:input.cwd,publishedOnly:true})
    const matches = entries.filter(entry => entry.name === input.name)
    const entry = matches.find(entry => entry.scope === 'project') ?? matches[0]
    if (!entry) throw new Error('未找到已发布的工作流名称')
    workflowId = entry.id
  }
  if (workflowId) {
    let detail = await getWorkflowCatalogDetail({workflowId,cwd:input.cwd})
    if (detail.record.status === 'archived') throw new Error('Archived workflows cannot run')
    if (input.mode !== 'test') {
      if (!detail.record.publishedRevision) throw new Error('正式运行需要先发布；草稿请使用测试')
      if (input.revision !== undefined && input.revision !== detail.record.publishedRevision) throw new Error('正式运行仅使用当前已发布快照；其他修订请使用测试')
      revision = detail.record.publishedRevision
    } else revision = input.revision ?? detail.record.currentRevision
    detail = await getWorkflowCatalogDetail({workflowId,cwd:input.cwd,revision})
    definition = detail.revision.definition
  } else {
    if (input.revision !== undefined) throw new Error('revision requires a catalog workflow')
    if (input.definitionPath) {
      if (!path.isAbsolute(input.definitionPath) && !input.cwd) throw new Error('Relative definitionPath requires a project directory')
      definition = JSON.parse(fs.readFileSync(path.resolve(input.cwd ?? '',input.definitionPath),'utf8'))
    }
    // Inline/file definitions are explicit one-off snapshots, never catalog publication.
  }
  validateDefinition(definition)
  return {definition,revision,workflowId}
}
export async function resolveChildren(definition: any, cwd?: string, workflowId?: string) {
  const refs: any[] = [], nested: Record<string,any> = {}
  walkWorkflowNodes(definition.graph, node => {
    if (node.type === 'workflow' && !node.disabled) refs.push({...(node.workflowId ? {workflowId:node.workflowId}:{}),...(node.name ? {name:node.name}:{}),...(node.revision ? {revision:node.revision}:{})})
  })
  for (const ref of refs) {
    if ((workflowId && ref.workflowId === workflowId) || ref.name === definition.meta.name) throw new Error('Workflow cannot invoke itself')
    const child = await resolveDefinition({...ref,cwd,mode:'run'})
    if (child.workflowId === workflowId && workflowId) throw new Error('Workflow cannot invoke itself')
    walkWorkflowNodes(child.definition.graph,node => {if (node.type === 'workflow' && !node.disabled) throw new Error('只支持一层子工作流')})
    nested[JSON.stringify(ref)] = child.definition
  }
  return nested
}
