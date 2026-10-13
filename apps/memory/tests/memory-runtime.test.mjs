import { test, expect } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { connect, call } from './mcp-client.mjs'
const entry = fileURLToPath(new URL('../src/memory-server/cli.mjs', import.meta.url))

test('real Memory tools persist and serialize simultaneous writes across MCP processes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'memory-runtime-'))
  const file = join(temporary, 'App Data', 'knowledge-graph.jsonl')
  const sessions = []
  try {
    sessions.push(await connect(entry, [file]), await connect(entry, [file]))
    const [a, b] = sessions.map(session => session.client)
    expect((await a.listTools()).tools).toHaveLength(9)
    await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 ? a : b, 'create_entities', {
      entities: [{ name: `项目-${i}`, entityType: '项目', observations: [`目标 ${i}`] }],
    })))
    expect((await call(a, 'read_graph', {})).entities).toHaveLength(20)
    await call(a, 'create_relations', { relations: [{ from: '项目-0', to: '项目-1', relationType: '依赖' }] })
    await call(b, 'add_observations', { observations: [{ entityName: '项目-0', contents: ['已完成'] }] })
    expect((await call(a, 'search_nodes', { query: '已完成' })).entities[0].name).toBe('项目-0')
    expect((await call(a, 'open_nodes', { names: ['项目-0'] })).relations).toHaveLength(1)
    await call(a, 'delete_observations', { deletions: [{ entityName: '项目-0', observations: ['已完成'] }] })
    await call(b, 'delete_relations', { relations: [{ from: '项目-0', to: '项目-1', relationType: '依赖' }] })
    await call(a, 'delete_entities', { entityNames: ['项目-19'] })
    const before = await readFile(file, 'utf8')
    await Promise.all(sessions.splice(0).map(session => session.close()))
    sessions.push(await connect(entry, [file]))
    const graph = await call(sessions[0].client, 'read_graph', {})
    expect(graph.entities).toHaveLength(19)
    expect(graph.relations).toHaveLength(0)
    expect(await readFile(file, 'utf8')).toBe(before)
    const resource = await sessions[0].client.readResource({ uri: 'memory://knowledge-graph' })
    expect(JSON.parse(resource.contents[0].text).entities).toHaveLength(19)
  } finally {
    await Promise.all(sessions.map(session => session.close()))
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)

test('launcher rejects missing or relative data paths', async () => {
  await expect(connect(entry)).rejects.toThrow('absolute App data path')
  await expect(connect(entry, ['memory.jsonl'])).rejects.toThrow('absolute App data path')
})
