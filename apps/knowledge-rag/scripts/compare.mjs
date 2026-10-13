import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { KnowledgeService, EMBEDDING_MODEL } from '../src/backend/service.mjs'
import { connectEngine } from '../src/backend/mcp.mjs'
import { render, markdown } from './report.mjs'

const app = fileURLToPath(new URL('..', import.meta.url)), repo = path.resolve(app, '../..')
const { createLibraryService } = await import(path.join(repo, 'apps/library/src/backend/store.mjs'))
const cache = path.join(repo, '.cache/knowledge-rag'), output = path.join(repo, 'artifacts/moss.knowledge-rag/comparison')
await fs.mkdir(output, { recursive: true })
const corpusText = await fs.readFile(path.join(app,'tests/comparison-corpus.json'),'utf8'), corpus = JSON.parse(corpusText)
const hash = createHash('sha256').update(corpusText).digest('hex')
await fs.writeFile(path.join(output,'frozen-corpus.sha256'), hash + '\n')
const run = await fs.mkdtemp(path.join(output,'run-')), documents = path.join(run,'documents')
await fs.mkdir(documents)
for (const doc of corpus.documents) await fs.writeFile(path.join(documents,doc.file), doc.content)
await fs.copyFile(path.join(app,'tests/comparison-corpus.json'), path.join(output,'corpus.json'))
const python = process.env.MOSS_RAG_TEST_PYTHON || path.join(cache,'venv/bin/python')
const library = createLibraryService({ libraryRoot: path.join(run,'library'), parserPath: path.join(repo,'apps/library/src/backend/library_parser.py'), pythonPath: python })
let registered
const rag = new KnowledgeService({ dataDir: path.join(run,'rag'), resourcesDir: path.join(app,'resources'), enginePython: python, modelsCache: path.join(cache,'models'), register: async config => { registered = config }, onChanged: value => console.log(`[engine] ${value.state}: ${value.message || value.error || ''}`) })
const elapsed = async fn => { const start=performance.now(); const result=await fn(); return { result, ms:performance.now()-start } }
const percentile = (values, p) => { const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)] || 0 }
const basename = result => path.basename(result.filepath || result.relativePath || result.source || '')
const hits = rows => rows.map(row => ({ source:basename(row), score:row.score, content:String(row.content || row.matchedChunk || row.snippet || ''), context:String(row.context || '') }))
function metrics(query, result) {
  const expected = new Set(query.expected), found = new Set(result.map(hit=>hit.source))
  const rank = result.findIndex(hit=>expected.has(hit.source))
  const evidence = result.map(hit=>hit.content+'\n'+hit.context).join('\n').toLowerCase()
  return { recall: expected.size ? [...expected].filter(name=>found.has(name)).length/expected.size : null,
    reciprocalRank: expected.size ? (rank<0?0:1/(rank+1)) : null,
    evidenceCoverage: query.evidence.length ? query.evidence.filter(phrase=>evidence.includes(phrase.toLowerCase())).length/query.evidence.length : null,
    returned:result.length }
}
let second
try {
  const libraryIndex = await elapsed(async () => {
    await library.importFiles({ collectionId:library.listCollections()[0].id, paths:corpus.documents.map(doc=>path.join(documents,doc.file)) })
    await library.waitForIdle()
    assert.equal(library.listResources({}).length,corpus.documents.length)
  })
  const startup = await elapsed(()=>rag.start())
  const ragIndex = await elapsed(async () => {
    await rag.importFiles({ paths:corpus.documents.map(doc=>path.join(documents,doc.file)) })
    const deadline=Date.now()+20*60000
    while (true) {
      const {reindex}=await rag.call('get_reindex_status')
      console.log('[index]',JSON.stringify(reindex))
      if(!reindex?.active) { assert.ok(!reindex?.last_error,JSON.stringify(reindex)); assert.equal(Number(reindex?.last_result?.errors || 0),0,JSON.stringify(reindex)); break }
      if(Date.now()>deadline) throw new Error('Indexing timed out')
      await new Promise(resolve=>setTimeout(resolve,2000))
    }
    assert.equal((await rag.list()).total,corpus.documents.length)
  })
  second=await connectEngine(registered.url,registered.headers.Authorization.slice(7))
  const [firstStats,secondStats]=await Promise.all([rag.call('get_index_stats'),second.call('get_index_stats')])
  assert.equal(firstStats.stats.total_documents,secondStats.stats.total_documents)
  const rows=[]
  for(const query of corpus.queries) {
    const a=await elapsed(()=>library.search({query:query.query,limit:5})), b=await elapsed(()=>rag.search({query:query.query,limit:5}))
    const left=hits(a.result),right=hits(b.result.items)
    const warmA=await elapsed(()=>library.search({query:query.query,limit:5})),warmB=await elapsed(()=>rag.search({query:query.query,limit:5}))
    rows.push({...query,library:{hits:left,ms:a.ms,warmMs:warmA.ms,...metrics(query,left)},rag:{hits:right,ms:b.ms,warmMs:warmB.ms,...metrics(query,right)}})
    console.log(`${query.id} ${query.kind} library=${left[0]?.source||'-'} rag=${right[0]?.source||'-'}`)
  }
  const summarize=(subset,key)=>{
    const answerable=subset.filter(row=>row.expected.length), unknown=subset.filter(row=>!row.expected.length)
    const average=field=>answerable.reduce((total,row)=>total+row[key][field],0)/(answerable.length||1)
    return {queries:subset.length,answerable:answerable.length,recallAt5:average('recall'),mrrAt5:average('reciprocalRank'),evidenceCoverage:average('evidenceCoverage'),
      emptyOnUnknown:unknown.filter(row=>!row[key].hits.length).length,unknownCount:unknown.length,
      p50Ms:percentile(subset.map(row=>row[key].ms),.5),p95Ms:percentile(subset.map(row=>row[key].ms),.95),warmP50Ms:percentile(subset.map(row=>row[key].warmMs),.5)}
  }
  const byKind=Object.fromEntries([...new Set(rows.map(row=>row.kind))].map(kind=>[kind,{library:summarize(rows.filter(row=>row.kind===kind),'library'),rag:summarize(rows.filter(row=>row.kind===kind),'rag')}]))
  const rssKiB=Number(execFileSync('ps',['-o','rss=','-p',String(rag.process.pid)],{encoding:'utf8'}).trim())
  const model=JSON.parse(await fs.readFile(path.join(cache,'models/moss-model.json'),'utf8'))
  const result={at:new Date().toISOString(),corpusHash:hash,documents:corpus.documents.length,queries:rows.length,runDir:run,
    environment:{platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,node:process.version,python:execFileSync(python,['--version'],{encoding:'utf8'}).trim(),dependencies:JSON.parse(execFileSync(python,['-c',"import json; from importlib.metadata import version; print(json.dumps({k:version(k) for k in ['knowledge-rag','chromadb','fastembed','mcp','onnxruntime']}))"],{encoding:'utf8'}))},
    configuration:{model:EMBEDDING_MODEL,modelArtifact:model,ragAlpha:.7,reranker:false,topK:5,modelPreCached:true},
    timing:{libraryIndexMs:libraryIndex.ms,ragStartupMs:startup.ms,ragIndexMs:ragIndex.ms,pythonRssMiB:rssKiB/1024,nodeHarnessRssMiB:process.memoryUsage().rss/1048576},
    summary:{library:summarize(rows,'library'),rag:summarize(rows,'rag')},byKind,rows,checks:['Same corpus and frozen queries','Real local CPU ONNX embeddings + ChromaDB','Two simultaneous HTTP MCP clients use one process']}
  await second.close();second=null
  await rag.stopProcess();await rag.start()
  assert.equal((await rag.list()).total,corpus.documents.length)
  const read=await rag.read({filepath:(await rag.list()).items[0].filepath})
  assert.ok(read.content.length>0)
  result.checks.push('Engine restart retains documents and readable content')
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n')
  await fs.writeFile(path.join(output,'report.html'),render(result))
  await fs.writeFile(path.join(output,'report.md'),markdown(result))
  console.log(JSON.stringify({summary:result.summary,byKind,report:path.join(output,'report.html')},null,2))
} catch(error){console.error(rag.logs);throw error}
finally{await second?.close().catch(()=>{});await rag.close();library.close();await library.waitForIdle()}
