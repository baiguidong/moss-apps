import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connect, call } from './mcp-client.mjs'
const entry = fileURLToPath(new URL('../server/cli.mjs', import.meta.url))

test('real Filesystem reads, writes, previews, moves and searches within the configured directory', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'filesystem-tools-')); let session
  try {
    session = await connect(entry, [JSON.stringify({ directories: [root], disabledTools: [] })])
    const client = session.client, file = join(root, 'note.txt'), moved = join(root, 'note moved.txt')
    assert.equal(((await client.listTools()).tools).length, 14)
    await call(client, 'write_file', { path: file, content: '第一行\n第二行\n' })
    assert.ok((await call(client, 'read_text_file', { path: file })).includes('第一行'))
    await call(client, 'edit_file', { path: file, edits: [{ oldText: '第二行', newText: '更新内容' }], dryRun: true })
    assert.ok(!(await readFile(file, 'utf8')).includes('更新内容'))
    await call(client, 'edit_file', { path: file, edits: [{ oldText: '第二行', newText: '更新内容' }] })
    await call(client, 'move_file', { source: file, destination: moved })
    assert.ok((await call(client, 'search_files', { path: root, pattern: '*.txt' })).includes('note moved.txt'))
    assert.ok((await call(client, 'list_directory', { path: root })).includes('note moved.txt'))
    assert.ok((await call(client, 'get_file_info', { path: moved })).includes('size:'))
    await call(client, 'create_directory', { path: join(root, 'nested') })
    assert.ok((await call(client, 'directory_tree', { path: root })).includes('nested'))
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
})

test('client Roots and symlinks cannot expand the App directory scope', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'filesystem-scope-')); let session
  try {
    const allowed = join(root, 'allowed'), outside = join(root, 'outside')
    await mkdir(allowed); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'outside fixture')
    await symlink(outside, join(allowed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    session = await connect(entry, [JSON.stringify({ directories: [allowed], disabledTools: [] })], { roots: [{ uri: pathToFileURL(outside).href }] })
    const client = session.client
    await client.notification({ method: 'notifications/roots/list_changed' })
    for (const path of [join(outside, 'secret.txt'), join(allowed, 'escape', 'secret.txt')]) {
      const result = await client.callTool({ name: 'read_text_file', arguments: { path } })
      assert.equal(result.isError, true)
    }
    await assert.rejects(call(client, 'write_file', { path: join(allowed, 'escape', 'new.txt'), content: 'blocked' }), /Access denied/)
    assert.ok(!(await call(client, 'list_allowed_directories')).includes(outside))
    assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'outside fixture')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
})

test('an empty App scope can inspect tools without gaining access to its process directory', { timeout: 30_000 }, async () => {
  const session = await connect(entry, [JSON.stringify({ directories: [], disabledTools: [] })])
  try {
    assert.equal(((await session.client.listTools()).tools).length, 14)
    await assert.rejects(call(session.client, 'list_directory', { path: '.' }), /Access denied/)
    assert.equal((await call(session.client, 'list_allowed_directories')).trim(), 'Allowed directories:')
  } finally { await session.close() }
})

test('missing configured directories still report errors', { timeout: 30_000 }, async () => {
  await assert.rejects(connect(entry, [JSON.stringify({ directories: [join(tmpdir(), 'missing-moss-dir-283742')], disabledTools: [] })]), /目录不存在/)
})

test('concurrent sessions default to their own workspace and append public directories', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'filesystem-sessions-')), sessions = []
  try {
    const a = join(root, '会话 A'), b = join(root, 'Session B'), shared = join(root, 'Shared'), outside = join(root, 'Outside')
    for (const [directory, content] of [[a, 'A'], [b, 'B'], [shared, 'shared'], [outside, 'outside']]) {
      await mkdir(directory); await writeFile(join(directory, 'note.txt'), content)
    }
    const config = JSON.stringify({ directories: [shared], disabledTools: [] })
    sessions.push(...await Promise.all([a, b].map(workspace => connect(entry, [config], {
      env: { MOSS_SESSION_WORKSPACE: workspace }, roots: [{ uri: pathToFileURL(outside).href }],
    }))))
    assert.deepEqual(await Promise.all(sessions.map(session => call(session.client, 'read_text_file', { path: 'note.txt' }))), ['A', 'B'])
    for (const [index, session] of sessions.entries()) {
      await session.client.notification({ method: 'notifications/roots/list_changed' })
      assert.equal(await call(session.client, 'read_text_file', { path: join(shared, 'note.txt') }), 'shared')
      await assert.rejects(call(session.client, 'read_text_file', { path: join(index ? a : b, 'note.txt') }), /Access denied/)
      await assert.rejects(call(session.client, 'read_text_file', { path: join(outside, 'note.txt') }), /Access denied/)
      await call(session.client, 'write_file', { path: 'new.txt', content: String(index) })
    }
    assert.equal(await readFile(join(a, 'new.txt'), 'utf8'), '0')
    assert.equal(await readFile(join(b, 'new.txt'), 'utf8'), '1')
    await assert.rejects(readFile(join(shared, 'new.txt')))
    await writeFile(join(shared, 'only-shared.txt'), 'public only')
    await assert.rejects(call(sessions[0].client, 'read_text_file', { path: 'only-shared.txt' }), /ENOENT/)
    await symlink(outside, join(a, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(call(sessions[0].client, 'read_text_file', { path: 'escape/note.txt' }), /Access denied/)
    const empty = await connect(entry, [JSON.stringify({ directories: [], disabledTools: [] })], { env: { MOSS_SESSION_WORKSPACE: a } })
    sessions.push(empty)
    assert.equal(await call(empty.client, 'read_text_file', { path: 'note.txt' }), 'A')
    await assert.rejects(call(empty.client, 'read_text_file', { path: join(shared, 'note.txt') }), /Access denied/)
  } finally { await Promise.all(sessions.map(session => session.close())); await rm(root, { recursive: true, force: true }) }
})
