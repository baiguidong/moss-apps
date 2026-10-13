import { test, expect } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { connect, call } from './mcp-client.mjs'
const entry = fileURLToPath(new URL('../src/sequential-server/cli.mjs', import.meta.url))

test('real tool supports steps, revisions and branches with isolated, nonpersistent history and no thought logs', async () => {
  const first = await connect(entry), second = await connect(entry)
  const thought = 'Synthetic private test marker 98467'
  try {
    expect((await first.client.listTools()).tools.map(tool => tool.name)).toEqual(['sequentialthinking'])
    const step = { thought, thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true }
    expect(await call(first.client, 'sequentialthinking', step)).toMatchObject({ thoughtHistoryLength: 1 })
    expect(await call(first.client, 'sequentialthinking', { ...step, thoughtNumber: 2, isRevision: true, revisesThought: 1 })).toMatchObject({ thoughtHistoryLength: 2 })
    expect(await call(first.client, 'sequentialthinking', { ...step, thoughtNumber: 3, branchFromThought: 1, branchId: 'alternative', nextThoughtNeeded: false })).toMatchObject({ branches: ['alternative'], nextThoughtNeeded: false })
    expect(await call(second.client, 'sequentialthinking', step)).toMatchObject({ thoughtHistoryLength: 1, branches: [] })
    const invalid = await first.client.callTool({ name: 'sequentialthinking', arguments: { ...step, thoughtNumber: 0 } })
    expect(invalid.isError).toBe(true)
    expect(first.stderr()).not.toContain(thought)
    expect(second.stderr()).not.toContain(thought)
  } finally { await first.close(); await second.close() }
})
