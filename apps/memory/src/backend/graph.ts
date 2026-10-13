import { open } from 'node:fs/promises'
import { GRAPH_PAGE_SIZE, selectGraph, type GraphRecords } from '../lib/graph-data'
import type { GraphInput, MemoryEntity, MemoryRelation } from '../contracts'

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_RESULT_BYTES = 512 * 1024

export function validateGraphInput(raw: unknown): GraphInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('图谱查询参数无效。')
  const value = raw as GraphInput
  if (Object.keys(value).some(key => !['query', 'entityType', 'offset'].includes(key))
    || (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 200))
    || (value.entityType !== undefined && (typeof value.entityType !== 'string' || value.entityType.length > 1000))
    || (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 0))) throw new Error('图谱查询参数无效。')
  return value
}

export function parseGraph(text: string): GraphRecords {
  const graph: GraphRecords = { entities: [], relations: [] }
  const names = new Set<string>()
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue
    let item
    try { item = JSON.parse(line) }
    catch { throw new Error(`记忆文件第 ${index + 1} 行无法解析，请检查文件内容。`) }
    if (!item || typeof item !== 'object') throw new Error(`记忆文件第 ${index + 1} 行格式不正确。`)
    if (item.type === 'entity') {
      const entity = item as MemoryEntity
      if (typeof entity.name !== 'string' || typeof entity.entityType !== 'string' || !Array.isArray(entity.observations)
        || entity.observations.some(value => typeof value !== 'string')) throw new Error(`记忆文件第 ${index + 1} 行的节点格式不正确。`)
      if (names.has(entity.name)) throw new Error('记忆文件包含重名节点，请通过对话整理后再查看。')
      names.add(entity.name)
      graph.entities.push({ name: entity.name, entityType: entity.entityType, observations: entity.observations })
    } else if (item.type === 'relation') {
      const relation = item as MemoryRelation
      if ([relation.from, relation.to, relation.relationType].some(value => typeof value !== 'string')) throw new Error(`记忆文件第 ${index + 1} 行的关系格式不正确。`)
      graph.relations.push({ from: relation.from, to: relation.to, relationType: relation.relationType })
    }
  }
  return graph
}

export async function readMemoryGraph(memoryFile: string, raw: unknown, signal?: AbortSignal) {
  const input = validateGraphInput(raw)
  if (!memoryFile) throw new Error('记忆存储位置尚未就绪，请稍后刷新。')
  signal?.throwIfAborted()
  let file
  try { file = await open(memoryFile, 'r') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return selectGraph({ entities: [], relations: [] }, input)
    throw error
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('记忆存储位置不是文件。')
    if (stat.size > MAX_FILE_BYTES) throw new Error('记忆文件超过 16 MB，请通过对话搜索或整理记忆后再打开图谱。')
    // The writer replaces the file atomically. Read the opened snapshot, with a bounded buffer.
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE_BYTES + 1))
    let length = 0
    while (length < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > stat.size) throw new Error('记忆文件正在变化，请刷新重试。')
    const graph = parseGraph(bytes.subarray(0, length).toString('utf8'))
    let limit = GRAPH_PAGE_SIZE
    while (true) {
      signal?.throwIfAborted()
      const result = selectGraph(graph, input, stat.mtimeMs, limit)
      if (Buffer.byteLength(JSON.stringify(result)) <= MAX_RESULT_BYTES) return result
      if (limit === 1) throw new Error('单条记忆或其关系内容过大，请通过对话查看或整理。')
      limit = Math.max(1, Math.floor(limit / 2))
    }
  } finally { await file.close() }
}
