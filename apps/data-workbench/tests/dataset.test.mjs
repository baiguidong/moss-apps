import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { APP_ERROR_CODES } from '@moss/app-sdk'
import { registerDatasetActions } from '../src/backend/dataset.mjs'

async function fixture(run, { queryRows, resultLimits } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-shared-dataset-'))
  const dataDir = path.join(root, 'state')
  const actions = new Map()
  queryRows ||= async (_ctx, sql) => sql.startsWith('DESCRIBE ')
    ? [{ column_name: 'value', column_type: 'VARCHAR', null: 'YES' }]
    : [{ value: 'public' }]
  registerDatasetActions({ registerAction(name, action) { actions.set(name, action) } }, { queryRows, resultLimits })
  const context = (callerAppId = 'consumer.a', callerInstanceId = 'instance.a') => ({
    dataDir, source: { surface: 'app', callerAppId, callerInstanceId },
  })
  const call = (name, input, ctx = context()) => actions.get(name)(input, ctx)
  try { await run({ root, dataDir, call, context }) }
  finally { await fs.rm(root, { recursive: true, force: true }) }
}

test('concurrent shares persist and a result stays bound to its caller until removal', async () => {
  await fixture(async ({ root, dataDir, call, context }) => {
    const first = path.join(root, 'first.csv')
    const second = path.join(root, 'second.csv')
    await Promise.all([fs.writeFile(first, 'value\npublic\n'), fs.writeFile(second, 'value\nother\n')])
    const [one, two] = await Promise.all([
      call('dataset.sources.add', { path: first }),
      call('dataset.sources.add', { path: second }),
    ])
    const listed = await call('dataset.sources.list', {})
    assert.deepEqual(new Set(listed.sources.map(item => item.id)), new Set([one.source.id, two.source.id]))

    const result = await call('dataset.query', { sourceId: one.source.id, limit: 1 })
    const read = input => call('dataset.result.read', { resourceId: result.resourceId, ...input })
    const firstChunk = await read({ offset: 0, limit: 4 })
    const secondChunk = await read({ offset: firstChunk.nextOffset, limit: 100 })
    assert.deepEqual(JSON.parse(firstChunk.text + secondChunk.text), [{ value: 'public' }])
    assert.equal(secondChunk.nextOffset, null)
    await assert.rejects(
      call('dataset.result.read', { resourceId: result.resourceId, offset: 0, limit: 100 }, context('consumer.b', 'instance.b')),
      error => error.code === APP_ERROR_CODES.notFound,
    )
    await assert.rejects(
      call('dataset.result.read', { resourceId: result.resourceId, offset: 0, limit: 100 }, context('consumer.a', 'instance.b')),
      error => error.code === APP_ERROR_CODES.notFound,
    )

    await call('dataset.sources.remove', { sourceId: one.source.id })
    await assert.rejects(read({ offset: 0, limit: 100 }), error => error.code === APP_ERROR_CODES.notFound)
    assert.deepEqual((await call('dataset.sources.list', {})).sources, [two.source])

    await assert.rejects(
      call('dataset.result.read', { resourceId: randomUUID(), offset: 0, limit: 100 }),
      error => error.code === APP_ERROR_CODES.notFound && !error.message.includes(dataDir),
    )
  })
})

test('revision changes after same-size in-place edit with restored mtime', async () => {
  await fixture(async ({ root, call }) => {
    const file = path.join(root, 'revision.csv')
    await fs.writeFile(file, 'value\npublic\n')
    const fixed = new Date('2025-01-01T00:00:00.000Z')
    await fs.utimes(file, fixed, fixed)
    const sourceId = (await call('dataset.sources.add', { path: file })).source.id
    const before = await call('dataset.describe', { sourceId })
    const firstStat = await fs.stat(file)

    await new Promise(resolve => setTimeout(resolve, 20))
    await fs.writeFile(file, 'value\nchange\n')
    await fs.utimes(file, fixed, fixed)
    const nextStat = await fs.stat(file)
    assert.equal(nextStat.size, firstStat.size)
    assert.equal(nextStat.mtimeMs, firstStat.mtimeMs)
    assert.notEqual(nextStat.ctimeMs, firstStat.ctimeMs)

    const after = await call('dataset.describe', { sourceId })
    assert.notEqual(after.revision, before.revision)
    await assert.rejects(
      call('dataset.query', { sourceId, expectedRevision: before.revision }),
      error => error.code === APP_ERROR_CODES.conflict && error.details?.kind === 'source_revision',
    )
  })
})

test('changed source path and expired result do not expose local paths', async () => {
  await fixture(async ({ root, dataDir, call }) => {
    const file = path.join(root, 'shared.csv')
    await fs.writeFile(file, 'value\npublic\n')
    const sourceId = (await call('dataset.sources.add', { path: file })).source.id
    const result = await call('dataset.query', { sourceId })
    const recordFile = path.join(dataDir, 'dataset-results', result.resourceId + '.json')
    const record = JSON.parse(await fs.readFile(recordFile, 'utf8'))
    record.createdAt = Date.now() - 16 * 60_000
    await fs.writeFile(recordFile, JSON.stringify(record))
    await assert.rejects(
      call('dataset.result.read', { resourceId: result.resourceId, offset: 0, limit: 100 }),
      error => error.code === APP_ERROR_CODES.notFound && !error.message.includes(dataDir),
    )
    await assert.rejects(fs.stat(recordFile), error => error.code === 'ENOENT')

    const renamed = path.join(root, 'renamed.csv')
    await fs.rename(file, renamed)
    await fs.symlink(renamed, file)
    await assert.rejects(
      call('dataset.describe', { sourceId }),
      error => error.code === APP_ERROR_CODES.conflict && !error.message.includes(root),
    )
  })
})

test('full result cache rejects new queries, then expiry and unshare release space', async () => {
  await fixture(async ({ root, dataDir, call }) => {
    const file = path.join(root, 'limited.csv')
    await fs.writeFile(file, 'value\npublic\n')
    const sourceId = (await call('dataset.sources.add', { path: file })).source.id
    const first = await call('dataset.query', { sourceId })
    const second = await call('dataset.query', { sourceId })
    await assert.rejects(
      call('dataset.query', { sourceId }),
      error => error.code === APP_ERROR_CODES.resourceExhausted && !error.message.includes(dataDir),
    )
    const read = resourceId => call('dataset.result.read', { resourceId, offset: 0, limit: 1000 })
    assert.deepEqual(JSON.parse((await read(first.resourceId)).text), [{ value: 'public' }])
    assert.deepEqual(JSON.parse((await read(second.resourceId)).text), [{ value: 'public' }])

    const firstFile = path.join(dataDir, 'dataset-results', first.resourceId + '.json')
    const expired = new Date(Date.now() - 16 * 60_000)
    const record = JSON.parse(await fs.readFile(firstFile, 'utf8'))
    record.createdAt = expired.getTime()
    await fs.writeFile(firstFile, JSON.stringify(record))
    await fs.utimes(firstFile, expired, expired)
    const third = await call('dataset.query', { sourceId })
    await assert.rejects(read(first.resourceId), error => error.code === APP_ERROR_CODES.notFound)
    assert.deepEqual(JSON.parse((await read(second.resourceId)).text), [{ value: 'public' }])

    await call('dataset.sources.remove', { sourceId })
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'dataset-results')), [])
    await assert.rejects(read(second.resourceId), error => error.code === APP_ERROR_CODES.notFound)
    await assert.rejects(read(third.resourceId), error => error.code === APP_ERROR_CODES.notFound)

    const replacement = path.join(root, 'replacement.csv')
    await fs.writeFile(replacement, 'value\npublic\n')
    const replacementId = (await call('dataset.sources.add', { path: replacement })).source.id
    const result = await call('dataset.query', { sourceId: replacementId })
    assert.deepEqual(JSON.parse((await read(result.resourceId)).text), [{ value: 'public' }])
  }, { resultLimits: { maxResultFiles: 2, maxResultBytes: 1024, maxResultCacheBytes: 1024 } })
})
