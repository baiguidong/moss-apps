// Packaged regression checks: every reviewed defect must fail closed or complete safely.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const fromCore = file => import(pathToFileURL(path.join(core, file)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppExecutionHost } = await fromCore('ui/src/apps/app-execution-host.mjs')
const { installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { createExecutionProtocolDefinitions } = await fromCore('packages/app-sdk/src/execution/index.mjs')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-review-'))
const protocols = createExecutionProtocolDefinitions()
const host = new AppExecutionHost({ directory: path.join(directory, 'tasks'), createSource: async () => ({ sessionId: 'review-fixture' }), execute: async ({input}) => ({ value: { status: 'completed', output: { answer: input.prompt.includes('large-agent') ? '中文😀'.repeat(300000) : 42 } }, tokens: 1, toolCalls: 0 }) })
const runtime = new AppRuntimeHost({ rootDir: directory, nodeExecutable: process.execPath, beforeAppDeactivation: id => host.deactivate(id), hostCapabilityOptions: { protocols } })
for (const def of protocols) for (const method of Object.keys(def.methods)) runtime.registerHostHandler(def.protocol, method, (input, context) => host.handle(def.protocol, method, input, context))
const definition = { version: 3, kind: 'state-machine', meta: { name: 'review-flow', title: '隔离审查', description: '隔离目录，无外部工具' }, graph: { entry: 'start', nodes: [
  { id: 'start', type: 'start', title: '开始', outputSchema: {} },
  { id: 'code', type: 'code', title: '代码', language: 'javascript', outputSchema: {}, script: 'return 42' },
  { id: 'end', type: 'end', title: '结束', inputSchema: {}, input: [{ target: [], source: { kind: 'node-output', nodeId: 'code' } }] },
], edges: [{ source: 'start', target: 'code' }, { source: 'code', target: 'end' }] } }
const report = {}
try {
  await runtime.initialize()
  await installAppArchive(runtime, path.join(repo, 'artifacts/moss.workflow/0.1.9/moss.workflow-0.1.9.zip'))
  await runtime.setAppGrants('moss.workflow', ['execution:read','execution:run','execution:cancel','tasks:read','tasks:write','tasks:cancel'])
  const instance = (await runtime.listInstances('moss.workflow'))[0]
  const invoke = (name, input = {}, extra = {}) => runtime.invoke('moss.workflow', instance.id, name, input, { invocation: { surface: 'app' }, ...extra })
  const errorOf = async fn => { try { return { result: await fn() } } catch(error) { return { error: error.message } } }
  const wait = async run => { for(let n=0;n<100;n++){ const value=await invoke('run.get',{runId:run.id}); if(value.status!=='running')return value;await new Promise(r=>setTimeout(r,100))} throw new Error('Timed out') }
  const bad=structuredClone(definition);bad.meta.name='invalid-code';bad.graph.nodes[1].script='return input.'
  await assert.rejects(()=>invoke('catalog.create',{definition:bad}), /script/)
  report.invalidCodeRejected=true
  const draft=await invoke('catalog.create',{definition})
  await assert.rejects(()=>invoke('run.start',{workflowId:draft.record.id,revision:1,mode:'run'}), /发布/)
  await invoke('catalog.publish',{workflowId:draft.record.id})
  const resources=await invoke('composer.list',{query:definition.meta.name});assert.equal(resources[0].ref.revision,1)
  const prepared=await invoke('composer.resolve',{intent:'use',ref:resources[0].ref});assert.ok(prepared.tools.includes('workflow_run'))
  assert.equal((await wait(await invoke('run.start',{workflowId:draft.record.id,revision:1}))).result,42)
  await invoke('catalog.edit',{workflowId:draft.record.id,baseRevision:1,definition})
  await assert.rejects(()=>invoke('run.start',{workflowId:draft.record.id,revision:2,mode:'run'}), /发布/)
  report.formalRevisionChecked=true
  const first=await invoke('run.start',{definition},{requestId:'review-repeat'})
  await wait(first)
  const repeated=await invoke('run.start',{definition},{requestId:'review-repeat',timeoutMs:1500})
  assert.equal(repeated.id,first.id)
  await assert.rejects(()=>invoke('run.start',{definition,args:{changed:true}},{requestId:'review-repeat'}),/conflict/)
  report.repeatedRequest={firstRunId:first.id,retryRunId:repeated.id}
  const readFull=async value=>{let text='',offset=0;while(true){const chunk=await invoke('resource.read',{resourceRef:value.resourceRef,offset});assert.ok(Buffer.byteLength(JSON.stringify(chunk))<1024*1024);text+=chunk.text;if(chunk.nextOffset===null)break;offset=chunk.nextOffset}return JSON.parse(text)}
  const large=structuredClone(definition);large.graph.nodes[1].script='return "中文😀".repeat(300000)'
  const largeRun=await wait(await invoke('run.start',{definition:large}));assert.equal(largeRun.status,'completed');assert.equal(largeRun.result.truncated,true)
  assert.equal(await readFull(largeRun.result),'中文😀'.repeat(300000))
  await new Promise(r=>setTimeout(r,100))
  assert.equal(host.tasks[largeRun.taskId].status,'completed');assert.ok(Buffer.byteLength(JSON.stringify(host.tasks[largeRun.taskId].result))<32768)
  const agent=structuredClone(definition);agent.graph.nodes[1]={id:'code',type:'agent',title:'大结果',prompt:'large-agent',outputSchema:{type:'object',properties:{answer:{type:'string'}},required:['answer']}}
  const agentRun=await wait(await invoke('run.start',{definition:agent}));assert.equal(agentRun.status,'completed');assert.deepEqual(await readFull(agentRun.result),{answer:'中文😀'.repeat(300000)})
  report.largeCodeAndAgentResults=true
  const tools=(await runtime.listContributions({kinds:['tools'],loadSchemas:true})).tools;assert.equal(tools.length,6)
  const runTool=tools.find(t=>t.localId==='workflow_run');assert.ok(runTool)
  const toolRun=await runtime.invokeToolContribution(runTool.id,{operation:'start',definition},{invocation:{surface:'tool',sessionId:'review-fixture'}});assert.equal((await wait(toolRun)).result,42)
  await assert.rejects(()=>runtime.invokeToolContribution(runTool.id,{operation:'delete',workflowId:draft.record.id}),/Invalid input/)
  report.sixToolsWithEffectSeparation=true
  const cwd=path.join(directory,'selected-project');await fs.mkdir(cwd)
  const project=await invoke('catalog.create',{definition,scope:'project'},{invocation:{surface:'tool',workspace:cwd,sessionId:'review-fixture'}})
  assert.ok(await fs.stat(path.join(cwd,'.moss/workflows/.catalog',project.record.id,'manifest.json')))
  report.trustedProjectDefault=true
  for(let i=0;i<22;i++)await wait(await invoke('workflow_run',{operation:'start',definition}))
  const page1=await invoke('run.list',{limit:20}),page2=await invoke('run.list',{offset:20,limit:20});assert.equal(page1.length,20);assert.ok(page2.length>0);assert.ok(!page1.some(r=>page2.some(x=>x.id===r.id)))
  report.historyPagination=true
  report.passed=true
  report.timestamp=new Date().toISOString()
  await fs.mkdir(path.join(repo, 'artifacts/moss.workflow/verification/0.1.9'), { recursive: true })
  await fs.writeFile(path.join(repo, 'artifacts/moss.workflow/verification/0.1.9/review.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}finally{await runtime.shutdown();host.close();await fs.rm(directory,{recursive:true,force:true})}
