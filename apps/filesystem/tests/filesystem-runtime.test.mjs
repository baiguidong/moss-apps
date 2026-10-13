import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connect, call } from './mcp-client.mjs'
const entry = fileURLToPath(new URL('../src/server/cli.ts', import.meta.url))

test('real Filesystem reads, writes, previews, moves and searches within the configured directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'filesystem-tools-')); let session
  try {
    session = await connect(entry, [JSON.stringify({ directories: [root], disabledTools: [] })])
    const client = session.client, file = join(root, 'note.txt'), moved = join(root, 'note moved.txt')
    expect((await client.listTools()).tools).toHaveLength(14)
    await call(client, 'write_file', { path: file, content: '第一行\n第二行\n' })
    expect(await call(client, 'read_text_file', { path: file })).toContain('第一行')
    await call(client, 'edit_file', { path: file, edits: [{ oldText: '第二行', newText: '更新内容' }], dryRun: true })
    expect(await readFile(file, 'utf8')).not.toContain('更新内容')
    await call(client, 'edit_file', { path: file, edits: [{ oldText: '第二行', newText: '更新内容' }] })
    await call(client, 'move_file', { source: file, destination: moved })
    expect(await call(client, 'search_files', { path: root, pattern: '*.txt' })).toContain('note moved.txt')
    expect(await call(client, 'list_directory', { path: root })).toContain('note moved.txt')
    expect(await call(client, 'get_file_info', { path: moved })).toContain('size:')
    await call(client, 'create_directory', { path: join(root, 'nested') })
    expect(await call(client, 'directory_tree', { path: root })).toContain('nested')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
})

test('client Roots and symlinks cannot expand the App directory scope', async () => {
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
      expect(result.isError).toBe(true)
    }
    await expect(call(client, 'write_file', { path: join(allowed, 'escape', 'new.txt'), content: 'blocked' })).rejects.toThrow()
    expect(await call(client, 'list_allowed_directories')).not.toContain(outside)
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('outside fixture')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
}, 30_000)

test('an empty App scope can inspect tools without gaining access to its process directory', async () => {
  const session = await connect(entry, [JSON.stringify({ directories: [], disabledTools: [] })])
  try {
    expect((await session.client.listTools()).tools).toHaveLength(14)
    await expect(call(session.client, 'list_directory', { path: '.' })).rejects.toThrow()
    expect((await call(session.client, 'list_allowed_directories')).trim()).toBe('Allowed directories:')
  } finally { await session.close() }
})

test('missing configured directories still report errors', async () => {
  await expect(connect(entry, [JSON.stringify({ directories: [join(tmpdir(), 'missing-moss-dir-283742')], disabledTools: [] })])).rejects.toThrow('目录不存在')
})

test('concurrent sessions default to their own workspace and append public directories', async () => {
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
    expect(await Promise.all(sessions.map(session => call(session.client, 'read_text_file', { path: 'note.txt' })))).toEqual(['A', 'B'])
    for (const [index, session] of sessions.entries()) {
      await session.client.notification({ method: 'notifications/roots/list_changed' })
      expect(await call(session.client, 'read_text_file', { path: join(shared, 'note.txt') })).toBe('shared')
      await expect(call(session.client, 'read_text_file', { path: join(index ? a : b, 'note.txt') })).rejects.toThrow()
      await expect(call(session.client, 'read_text_file', { path: join(outside, 'note.txt') })).rejects.toThrow()
      await call(session.client, 'write_file', { path: 'new.txt', content: String(index) })
    }
    expect(await readFile(join(a, 'new.txt'), 'utf8')).toBe('0')
    expect(await readFile(join(b, 'new.txt'), 'utf8')).toBe('1')
    await expect(readFile(join(shared, 'new.txt'))).rejects.toThrow()
    await writeFile(join(shared, 'only-shared.txt'), 'public only')
    await expect(call(sessions[0].client, 'read_text_file', { path: 'only-shared.txt' })).rejects.toThrow()
    await symlink(outside, join(a, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(call(sessions[0].client, 'read_text_file', { path: 'escape/note.txt' })).rejects.toThrow()
    const empty = await connect(entry, [JSON.stringify({ directories: [], disabledTools: [] })], { env: { MOSS_SESSION_WORKSPACE: a } })
    sessions.push(empty)
    expect(await call(empty.client, 'read_text_file', { path: 'note.txt' })).toBe('A')
    await expect(call(empty.client, 'read_text_file', { path: join(shared, 'note.txt') })).rejects.toThrow()
  } finally { await Promise.all(sessions.map(session => session.close())); await rm(root, { recursive: true, force: true }) }
}, 30_000)
