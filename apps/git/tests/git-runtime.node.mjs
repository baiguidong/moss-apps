import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { connect, call } from './mcp-client.mjs'
import { seedRepository } from './repository.mjs'
import { findGit } from '../src/server/git'
const entry = fileURLToPath(new URL('../server/cli.mjs', import.meta.url))

test('all 12 Git tools operate on a real repository and reset preserves working files', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-tools-')); let session
  try {
    const repo = await seedRepository(join(root, 'Repo With Spaces'))
    session = await connect(entry, [JSON.stringify({ directories: [repo.path], disabledTools: [], gitExecutable: await findGit() })])
    const client = session.client, invoke = (name, args = {}) => call(client, name, { repo_path: repo.path, ...args })
    assert.equal(((await client.listTools()).tools).length, 12)
    assert.ok((await invoke('git_status')).includes('main'))
    await writeFile(join(repo.path, 'note.txt'), 'changed\n')
    assert.ok((await invoke('git_diff_unstaged')).includes('+changed'))
    assert.ok((await invoke('git_diff', { target: 'HEAD' })).includes('+changed'))
    await invoke('git_add', { files: ['note.txt'] })
    assert.ok((await invoke('git_diff_staged')).includes('+changed'))
    await invoke('git_reset')
    assert.equal(await readFile(join(repo.path, 'note.txt'), 'utf8'), 'changed\n')
    assert.equal(repo.git(['diff', '--cached']), '')
    await invoke('git_add', { files: ['note.txt'] })
    assert.ok((await invoke('git_commit', { message: 'Fixture change' })).includes('hash'))
    assert.ok((await invoke('git_log', { max_count: 1 })).includes('Fixture change'))
    assert.ok((await invoke('git_show', { revision: 'HEAD' })).includes('Fixture change'))
    await invoke('git_create_branch', { branch_name: 'feature/test', base_branch: 'main' })
    assert.ok((await invoke('git_branch', { branch_type: 'local', contains: 'HEAD' })).includes('feature/test'))
    await invoke('git_checkout', { branch_name: 'feature/test' })
    assert.equal(repo.git(['branch', '--show-current']), 'feature/test')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
})

test('session repositories take precedence while public repositories remain available to concurrent sessions', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-sessions-')), sessions = []
  try {
    const a = await seedRepository(join(root, '会话 A')), b = await seedRepository(join(root, 'Session B')), shared = await seedRepository(join(root, 'Shared'))
    a.git(['branch', '-m', 'session-a']); b.git(['branch', '-m', 'session-b']); shared.git(['branch', '-m', 'public'])
    const config = JSON.stringify({ directories: [shared.path], disabledTools: [], gitExecutable: await findGit() })
    sessions.push(...await Promise.all([a.path, b.path].map(workspace => connect(entry, [config], { env: { MOSS_SESSION_WORKSPACE: workspace } }))))
    const statuses = await Promise.all(sessions.map(session => call(session.client, 'git_status')))
    assert.ok((statuses[0]).includes('session-a')); assert.ok((statuses[1]).includes('session-b'))
    for (const [index, session] of sessions.entries()) {
      assert.ok((await call(session.client, 'git_status', { repo_path: '.' })).includes(index ? 'session-b' : 'session-a'))
      assert.ok((await call(session.client, 'git_status', { repo_path: shared.path })).includes('public'))
      await assert.rejects(call(session.client, 'git_status', { repo_path: index ? a.path : b.path }), /未在 Git App 中授权/)
    }
    const configOnly = await connect(entry, [config]); sessions.push(configOnly)
    assert.ok((await call(configOnly.client, 'git_status')).includes('public'))
    const emptyConfig = JSON.stringify({ directories: [], disabledTools: [], gitExecutable: await findGit() })
    const sessionOnly = await connect(entry, [emptyConfig], { env: { MOSS_SESSION_WORKSPACE: a.path } }); sessions.push(sessionOnly)
    assert.ok((await call(sessionOnly.client, 'git_status')).includes('session-a'))
    await assert.rejects(call(sessionOnly.client, 'git_status', { repo_path: shared.path }), /未在 Git App 中授权/)
    const check = await connect(entry, [emptyConfig]); sessions.push(check)
    assert.equal(((await check.client.listTools()).tools).length, 12)
    await assert.rejects(call(check.client, 'git_status'), /请在会话中使用 Git/)
  } finally { await Promise.all(sessions.map(session => session.close())); await rm(root, { recursive: true, force: true }) }
})

test('a non-repository workspace keeps its default and can select a repository inside it', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workspace-')); let session
  try {
    const workspace = join(root, 'Workspace'); await mkdir(workspace)
    const nested = await seedRepository(join(workspace, 'Nested')), shared = await seedRepository(join(root, 'Shared'))
    session = await connect(entry, [JSON.stringify({ directories: [shared.path], disabledTools: [], gitExecutable: await findGit() })], { env: { MOSS_SESSION_WORKSPACE: workspace } })
    await assert.rejects(call(session.client, 'git_status'), /not a git repository/)
    assert.ok((await call(session.client, 'git_status', { repo_path: 'Nested' })).includes('main'))
    const outside = await seedRepository(join(root, 'Outside'))
    await symlink(outside.path, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(call(session.client, 'git_status', { repo_path: 'escape' }), /未在 Git App 中授权/)
    assert.equal(nested.git(['status', '--porcelain']), '')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
})

test('rejects unconfigured repositories, path traversal and Git argument injection', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-scope-')); let session
  try {
    const repo = await seedRepository(join(root, 'allowed')), outside = await seedRepository(join(root, 'outside'))
    session = await connect(entry, [JSON.stringify({ directories: [repo.path], disabledTools: [], gitExecutable: await findGit() })], { env: { GIT_DIR: join(outside.path, '.git'), GIT_WORK_TREE: outside.path } })
    const client = session.client
    await assert.rejects(call(client, 'git_status', { repo_path: outside.path }), /未在 Git App 中授权/)
    for (const files of [['../outside/note.txt'], [join(outside.path, 'note.txt')]]) {
      await assert.rejects(call(client, 'git_add', { repo_path: repo.path, files }), /超出当前仓库/)
    }
    await symlink(outside.path, join(repo.path, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(call(client, 'git_add', { repo_path: repo.path, files: ['escape/note.txt'] }), /符号链接/)
    await assert.rejects(call(client, 'git_show', { repo_path: repo.path, revision: '--output=bad' }), /Invalid Git reference/)
    await assert.rejects(call(client, 'git_checkout', { repo_path: repo.path, branch_name: '--orphan=bad' }), /Invalid Git reference/)
    await assert.rejects(call(client, 'git_log', { repo_path: repo.path, max_count: 100000 }))
    await writeFile(join(repo.path, '-A'), 'literal path\n')
    await call(client, 'git_add', { repo_path: repo.path, files: ['-A'] })
    assert.equal(repo.git(['diff', '--cached', '--name-only']), '-A')
    assert.equal(outside.git(['status', '--porcelain']), '')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
})
