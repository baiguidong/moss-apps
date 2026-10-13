import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, stat, rename, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compileJsonSchema } from '@moss/app-sdk'
import { readMemoryGraph, parseGraph } from '../src/backend/graph'
import { selectGraph } from '../src/lib/graph-data'
import schema from '../schemas/graph.read.result.json'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function file() { const root = await mkdtemp(join(tmpdir(), 'memory-graph-')); roots.push(root); return join(root, 'memory.jsonl') }
const records = [
  { type: 'entity', name: '小林', entityType: '人物', observations: ['项目负责人', '<script>只是记忆文字</script>'] },
  { type: 'entity', name: '咖啡店网站', entityType: '项目', observations: ['设计阶段\n首页草图已完成'] },
  { type: 'entity', name: '菜单页面', entityType: '需求', observations: [] },
  { type: 'relation', from: '小林', to: '咖啡店网站', relationType: '负责' },
  { type: 'relation', from: '咖啡店网站', to: '菜单页面', relationType: '包含' },
]
const serialize = (items: unknown[]) => items.map(item => JSON.stringify(item)).join('\n') + '\n'

test('reads complete memory facts and directed relations without modifying the file', async () => {
  const path = await file(), contents = serialize(records)
  await writeFile(path, contents)
  const before = await stat(path)
  const graph = await readMemoryGraph(path, {})
  expect(graph).toMatchObject({ totalEntities: 3, totalRelations: 2, totalMatches: 3, nextOffset: null, unresolvedRelations: 0 })
  expect(graph.entities.find(entity => entity.name === '小林')?.observations[1]).toBe('<script>只是记忆文字</script>')
  expect(compileJsonSchema(schema)({ ok: true, data: graph })).toBe(true)
  expect(await readFile(path, 'utf8')).toBe(contents)
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs)
})

test('missing and empty files are empty graphs, while corrupt memory is an error', async () => {
  const path = await file()
  expect(await readMemoryGraph(path, {})).toMatchObject({ entities: [], relations: [], updatedAt: null })
  await writeFile(path, '\n')
  expect((await readMemoryGraph(path, {})).totalEntities).toBe(0)
  await writeFile(path, serialize(records) + '{broken')
  await expect(readMemoryGraph(path, {})).rejects.toThrow('第 6 行')
  expect(() => parseGraph(serialize([{ type: 'entity', name: 'x', entityType: 't', observations: [1] }]))).toThrow('节点格式')
  expect(() => parseGraph(serialize([records[0], records[0]]))).toThrow('重名')
})

test('searches facts, filters types, and pages deterministically without dangling edges', async () => {
  const path = await file()
  const entities = Array.from({ length: 125 }, (_, index) => ({ type: 'entity', name: `项目-${String(index).padStart(3, '0')}`, entityType: '项目', observations: ['待启动'] }))
  await writeFile(path, serialize([...records, ...entities, { type: 'relation', from: '已删除', to: '小林', relationType: '认识' }]))
  const graph = await readMemoryGraph(path, {})
  expect(graph.entities).toHaveLength(120)
  expect(graph).toMatchObject({ totalEntities: 128, nextOffset: 120, unresolvedRelations: 1 })
  const next = await readMemoryGraph(path, { offset: graph.nextOffset! })
  expect(next.entities).toHaveLength(8)
  expect(new Set([...graph.entities, ...next.entities].map(entity => entity.name)).size).toBe(128)
  const searched = await readMemoryGraph(path, { query: '草图', entityType: '项目' })
  expect(searched.entities.map(entity => entity.name)).toEqual(['咖啡店网站'])
  expect(searched.relations).toEqual([])
  expect(searched.types).toContainEqual({ name: '人物', count: 1 })
  expect((await readMemoryGraph(path, { query: '草图', entityType: '人物' })).entities).toEqual([])
})

test('preserves pagination when large observations require smaller result pages', async () => {
  const path = await file()
  await writeFile(path, serialize(Array.from({ length: 100 }, (_, index) => ({ type: 'entity', name: `n${index}`, entityType: '内容', observations: ['a'.repeat(7000)] }))))
  const first = await readMemoryGraph(path, {})
  expect(first.entities.length).toBeLessThan(100)
  const second = await readMemoryGraph(path, { offset: first.nextOffset! })
  expect(second.offset).toBe(first.entities.length)
  expect(second.nextOffset).toBeNull()
  expect(new Set([...first.entities, ...second.entities].map(entity => entity.name)).size).toBe(100)
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(512 * 1024)
})

test('refresh reads an atomically replaced snapshot and keeps self relations', async () => {
  const path = await file()
  await writeFile(path, serialize(records))
  const before = await readMemoryGraph(path, {})
  await writeFile(path + '.tmp', serialize([...records, { type: 'relation', from: '小林', to: '小林', relationType: '反思' }]))
  await rename(path + '.tmp', path)
  expect((await readMemoryGraph(path, {})).relations).toHaveLength(before.relations.length + 1)
})

test('rejects arbitrary paths, oversized files, malformed filters and cancelled reads', async () => {
  const path = await file()
  for (const input of [{ path: '/etc/passwd' }, { offset: -1 }, { query: 3 }, { entityType: [] }, null]) {
    await expect(readMemoryGraph(path, input)).rejects.toThrow('参数无效')
  }
  await writeFile(path, '')
  await truncate(path, 16 * 1024 * 1024 + 1)
  await expect(readMemoryGraph(path, {})).rejects.toThrow('超过 16 MB')
  await expect(readMemoryGraph(path, {}, AbortSignal.abort())).rejects.toThrow()
  expect(selectGraph({ entities: [], relations: [] }, { offset: 200 }).offset).toBe(0)
})
