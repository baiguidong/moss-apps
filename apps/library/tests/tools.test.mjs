import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileJsonSchema } from '@moss/app-sdk'
import { resolveToolAction } from '../src/backend/tools.mjs'
const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('app.moss.json', root)))
const schema = name => compileJsonSchema(JSON.parse(readFileSync(new URL(`schemas/${name}.json`, root))))
test('AI exposes exactly five CRUD tools with appropriate read/write/destructive effects', () => {
  assert.deepEqual(manifest.contributes.tools.map(t => [t.id, t.effect]), [['list','read'],['search','read'],['read','read'],['write','write'],['delete','destructive']])
  assert.ok(manifest.backend.actions.some(a => a.name === 'jobs.cancel'))
  assert.equal(manifest.contributes.tools.some(t => t.action === 'jobs.cancel'), false)
})
test('list routing preserves explicit filters and standard pagination', () => {
  assert.deepEqual(resolveToolAction('library.list', {}), { name: 'collections.list', input: {} })
  assert.deepEqual(resolveToolAction('library.list', { kind: 'resources', collectionId: 'c', offset: 4, limit: 8 }), { name: 'documents.list', input: { offset: 4, limit: 8, collectionIds: ['c'] } })
  assert.deepEqual(resolveToolAction('library.list', { kind: 'sources', collectionId: 'c' }), { name: 'sources.list', input: { collectionId: 'c' } })
  const valid = schema('library.list.input')
  assert.equal(valid({}), true)
  assert.equal(valid({ kind: 'resources', collectionId: 'c' }), true)
  assert.equal(valid({ collectionId: 'c' }), false)
  assert.equal(valid({ kind: 'resources', projectId: 'p' }), false)
})
test('write accepts explicit file paths only; delete requires a nonempty revision', () => {
  const valid = schema('library.write.input')
  const input = { collectionId: 'c', paths: ['/tmp/a.md', '/tmp/b.md'] }
  assert.equal(valid(input), true, JSON.stringify(valid.errors))
  assert.deepEqual(resolveToolAction('library.write', input), { name: 'files.import', input, options: { filesOnly: true } })
  for (const input of [
    { operation: 'import', collectionId: 'c', paths: ['/tmp/a.md'] },
    { operation: 'create', collectionId: 'c', title: 'A', content: 'x' },
    { operation: 'update', resourceId: 'r', revision: 'v', content: 'new' },
    { collectionId: 'c', paths: ['/tmp/a.md'], content: 'raw content' },
    { collectionId: 'c', paths: ['/tmp/a.md'], filesOnly: false },
    { collectionId: 'c', paths: [] },
    { paths: ['/tmp/a.md'] },
  ]) assert.equal(valid(input), false, JSON.stringify(input))
  assert.equal(schema('documents.delete.input')({ resourceId: 'r' }), false)
  assert.equal(schema('documents.delete.input')({ resourceId: 'r', revision: '' }), false)
  assert.equal(schema('documents.delete.input')({ resourceId: 'r', revision: 'v' }), true)
})
