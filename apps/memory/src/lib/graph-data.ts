import type { GraphInput, MemoryEntity, MemoryGraph, MemoryRelation } from '../contracts'

export const GRAPH_PAGE_SIZE = 120
export type GraphRecords = { entities: MemoryEntity[]; relations: MemoryRelation[] }

export function selectGraph(graph: GraphRecords, input: GraphInput = {}, updatedAt: number | null = null, limit = GRAPH_PAGE_SIZE): MemoryGraph {
  const query = (input.query || '').trim().toLocaleLowerCase()
  const types = new Map<string, number>()
  const names = new Set(graph.entities.map(entity => entity.name))
  for (const entity of graph.entities) types.set(entity.entityType, (types.get(entity.entityType) || 0) + 1)
  const matches = graph.entities.filter(entity =>
    (!input.entityType || entity.entityType === input.entityType)
    && (!query || [entity.name, entity.entityType, ...entity.observations].some(value => value.toLocaleLowerCase().includes(query))),
  ).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const requested = input.offset || 0
  const offset = requested < matches.length ? requested : Math.max(0, Math.floor((matches.length - 1) / GRAPH_PAGE_SIZE) * GRAPH_PAGE_SIZE)
  const entities = matches.slice(offset, offset + limit)
  const visible = new Set(entities.map(entity => entity.name))
  return {
    entities, relations: graph.relations.filter(relation => visible.has(relation.from) && visible.has(relation.to)),
    totalEntities: graph.entities.length, totalRelations: graph.relations.length, totalMatches: matches.length,
    types: [...types].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    offset, nextOffset: offset + entities.length < matches.length ? offset + entities.length : null, updatedAt,
    unresolvedRelations: graph.relations.filter(relation => !names.has(relation.from) || !names.has(relation.to)).length,
  }
}
