import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createBuilderActions } from '../src/backend/actions.mjs'

test('restored workspace keeps its pinned SDK and exposes the source root', async () => {
  const methods = []
  const actions = createBuilderActions(async (_protocol, method) => {
    methods.push(method)
    if (method === 'project.prepare') return { projectRef: 'restored', path: '/workspace/apps/sample', sourceRoot: '/workspace', toolchain: { packageManager: { name: 'bun', version: '1.3.10' } } }
    if (method === 'info.get') return { sdkHash: 'current', contractHash: 'current' }
    throw new Error('Historical SDK must not be overwritten')
  })
  const result = await actions.builder_prepare({ operation: 'project', intent: 'edit', projectId: 'sample' })
  assert.deepEqual(methods, ['project.prepare', 'info.get'])
  assert.equal(result.pinnedSdk, true)
  assert.equal(result.sourceRoot, '/workspace')
  assert.match(result.guidance, /never reconstruct or rewrite/)
})
