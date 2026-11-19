import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repo = path.resolve(appRoot, '../..')
const corpusPath = path.join(repo, 'apps/knowledge-rag/tests/comparison-corpus.json')
const corpusText = await fs.readFile(corpusPath, 'utf8')
const corpus = JSON.parse(corpusText)
const { RagService } = await import('../src/backend/service.mjs')
const output = path.join(repo, 'artifacts/moss.anything-rag/comparison')
await fs.mkdir(output, { recursive: true })
const run = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-anything-rag-comparison-'))
const documents = path.join(run, 'documents')
await fs.mkdir(documents)
for (const document of corpus.documents) await fs.writeFile(path.join(documents, document.file), document.content)

const dataDir = path.join(run, 'app')
if (process.env.MOSS_RAG_TEST_MODELS) {
  await fs.mkdir(path.join(dataDir, 'models'), { recursive: true })
  await fs.cp(process.env.MOSS_RAG_TEST_MODELS, path.join(dataDir, 'models'), { recursive: true })
}
const service = new RagService({ dataDir })
const started = performance.now()
await service.initialize()
const indexed = await service.importFiles({ paths: corpus.documents.map(document => path.join(documents, document.file)) })
const indexMs = performance.now() - started
if (indexed.failed.length) throw new Error(JSON.stringify(indexed.failed))

const rows = []
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] || 0
for (const query of corpus.queries) {
  const start = performance.now()
  const result = await service.search({ query: query.query, topK: 5 })
  const ms = performance.now() - start
  const sources = result.items.map(item => path.basename(item.source || item.filename))
  const expected = new Set(query.expected)
  const rank = sources.findIndex(source => expected.has(source))
  const evidence = result.items.map(item => item.content).join('\n').toLowerCase()
  rows.push({ ...query, hits: result.items.map(item => ({ source: path.basename(item.source || item.filename), score: item.score, content: item.content })), ms, accepted: result.accepted, refusal: result.refusal, recall: expected.size ? [...expected].filter(source => sources.includes(source)).length / expected.size : null, reciprocalRank: expected.size ? (rank < 0 ? 0 : 1 / (rank + 1)) : null, evidenceCoverage: query.evidence.length ? query.evidence.filter(phrase => evidence.includes(phrase.toLowerCase())).length / query.evidence.length : null })
}
const answerable = rows.filter(row => row.expected.length)
const unknown = rows.filter(row => !row.expected.length)
const average = field => answerable.reduce((sum, row) => sum + row[field], 0) / (answerable.length || 1)
const summary = { queries: rows.length, answerable: answerable.length, recallAt5: average('recall'), mrrAt5: average('reciprocalRank'), evidenceCoverage: average('evidenceCoverage'), emptyOnUnknown: unknown.filter(row => !row.hits.length).length, unknownCount: unknown.length, p50Ms: percentile(rows.map(row => row.ms), 0.5), p95Ms: percentile(rows.map(row => row.ms), 0.95) }
const knowledgeResults = process.env.MOSS_KNOWLEDGE_RAG_RESULTS ? JSON.parse(await fs.readFile(process.env.MOSS_KNOWLEDGE_RAG_RESULTS, 'utf8')) : null
const defaultNote = 'knowledge-rag was not run. Run apps/knowledge-rag/scripts/compare.mjs with Moss managed Python and a prepared model cache, then rerun with MOSS_KNOWLEDGE_RAG_RESULTS=... to produce the side-by-side report.'
const result = { status: knowledgeResults ? 'compared' : 'anything-only', at: new Date().toISOString(), corpusHash: createHash('sha256').update(corpusText).digest('hex'), engine: service.engine.status(), documents: corpus.documents.length, indexMs, summary, rows, knowledgeRag: knowledgeResults?.summary || null, comparisonNote: knowledgeResults ? 'knowledge-rag results loaded from MOSS_KNOWLEDGE_RAG_RESULTS.' : (process.env.MOSS_KNOWLEDGE_RAG_BLOCKER || defaultNote) }
await fs.writeFile(path.join(output, 'anything-results.json'), JSON.stringify(result, null, 2) + '\n')
const pct = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const comparison = knowledgeResults ? [`| Recall@5 | ${pct(summary.recallAt5)} | ${pct(knowledgeResults.summary.rag.recallAt5)} |`, `| MRR@5 | ${summary.mrrAt5.toFixed(3)} | ${knowledgeResults.summary.rag.mrrAt5.toFixed(3)} |`, `| Evidence coverage | ${pct(summary.evidenceCoverage)} | ${pct(knowledgeResults.summary.rag.evidenceCoverage)} |`].join('\n') : '| 对比状态 | anything-rag 已完成 | knowledge-rag 未运行（缺 Python 依赖/模型缓存） |'
const report = ['# Anything RAG 与 knowledge-rag 检索对比', '', `固定语料：${corpus.documents.length} 份文档、${corpus.queries.length} 个问题，SHA-256：${result.corpusHash}。`, '', '| 指标 | Anything RAG | knowledge-rag |', '| --- | ---: | ---: |', comparison, '', `Anything RAG 引擎：${result.engine.fallback ? 'fallback（离线诊断）' : `native ${result.engine.model}`}；模型 revision：${result.engine.revision || '未固定'}；索引耗时 ${indexMs.toFixed(1)} ms。`, '', result.comparisonNote, '', '逐题结果见 [anything-results.json](anything-results.json)。', ''].join('\n')
await fs.writeFile(path.join(output, 'comparison.md'), report)
await service.close()
await fs.rm(run, { recursive: true, force: true })
console.log(JSON.stringify({ status: result.status, summary, report: path.join(output, 'comparison.md'), comparisonNote: result.comparisonNote }, null, 2))
