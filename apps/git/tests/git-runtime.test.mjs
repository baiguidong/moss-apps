import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { connect, call } from './mcp-client.mjs'
import { seedRepository } from './repository.mjs'
import { findGit } from '../src/server/git'
const entry = fileURLToPath(new URL('../src/server/cli.ts', import.meta.url))

test('all 12 Git tools operate on a real repository and reset preserves working files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-tools-')); let session
  try {
    const repo = await seedRepository(join(root, 'Repo With Spaces'))
    session = await connect(entry, [JSON.stringify({ directories: [repo.path], disabledTools: [], gitExecutable: await findGit() })])
    const client = session.client, invoke = (name, args = {}) => call(client, name, { repo_path: repo.path, ...args })
    expect((await client.listTools()).tools).toHaveLength(12)
    expect(await invoke('git_status')).toContain('main')
    await writeFile(join(repo.path, 'note.txt'), 'changed\n')
    expect(await invoke('git_diff_unstaged')).toContain('+changed')
    expect(await invoke('git_diff', { target: 'HEAD' })).toContain('+changed')
    await invoke('git_add', { files: ['note.txt'] })
    expect(await invoke('git_diff_staged')).toContain('+changed')
    await invoke('git_reset')
    expect(await readFile(join(repo.path, 'note.txt'), 'utf8')).toBe('changed\n')
    expect(repo.git(['diff', '--cached'])).toBe('')
    await invoke('git_add', { files: ['note.txt'] })
    expect(await invoke('git_commit', { message: 'Fixture change' })).toContain('hash')
    expect(await invoke('git_log', { max_count: 1 })).toContain('Fixture change')
    expect(await invoke('git_show', { revision: 'HEAD' })).toContain('Fixture change')
    await invoke('git_create_branch', { branch_name: 'feature/test', base_branch: 'main' })
    expect(await invoke('git_branch', { branch_type: 'local', contains: 'HEAD' })).toContain('feature/test')
    await invoke('git_checkout', { branch_name: 'feature/test' })
    expect(repo.git(['branch', '--show-current'])).toBe('feature/test')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
}, 30_000)

test('session repositories take precedence while public repositories remain available to concurrent sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-sessions-')), sessions = []
  try {
    const a = await seedRepository(join(root, '会话 A')), b = await seedRepository(join(root, 'Session B')), shared = await seedRepository(join(root, 'Shared'))
    a.git(['branch', '-m', 'session-a']); b.git(['branch', '-m', 'session-b']); shared.git(['branch', '-m', 'public'])
    const config = JSON.stringify({ directories: [shared.path], disabledTools: [], gitExecutable: await findGit() })
    sessions.push(...await Promise.all([a.path, b.path].map(workspace => connect(entry, [config], { env: { MOSS_SESSION_WORKSPACE: workspace } }))))
    const statuses = await Promise.all(sessions.map(session => call(session.client, 'git_status')))
    expect(statuses[0]).toContain('session-a'); expect(statuses[1]).toContain('session-b')
    for (const [index, session] of sessions.entries()) {
      expect(await call(session.client, 'git_status', { repo_path: '.' })).toContain(index ? 'session-b' : 'session-a')
      expect(await call(session.client, 'git_status', { repo_path: shared.path })).toContain('public')
      await expect(call(session.client, 'git_status', { repo_path: index ? a.path : b.path })).rejects.toThrow('未在 Git App 中授权')
    }
    const configOnly = await connect(entry, [config]); sessions.push(configOnly)
    expect(await call(configOnly.client, 'git_status')).toContain('public')
    const emptyConfig = JSON.stringify({ directories: [], disabledTools: [], gitExecutable: await findGit() })
    const sessionOnly = await connect(entry, [emptyConfig], { env: { MOSS_SESSION_WORKSPACE: a.path } }); sessions.push(sessionOnly)
    expect(await call(sessionOnly.client, 'git_status')).toContain('session-a')
    await expect(call(sessionOnly.client, 'git_status', { repo_path: shared.path })).rejects.toThrow()
    const check = await connect(entry, [emptyConfig]); sessions.push(check)
    expect((await check.client.listTools()).tools).toHaveLength(12)
    await expect(call(check.client, 'git_status')).rejects.toThrow('请在会话中使用 Git')
  } finally { await Promise.all(sessions.map(session => session.close())); await rm(root, { recursive: true, force: true }) }
}, 30_000)

test('a non-repository workspace keeps its default and can select a repository inside it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workspace-')); let session
  try {
    const workspace = join(root, 'Workspace'); await mkdir(workspace)
    const nested = await seedRepository(join(workspace, 'Nested')), shared = await seedRepository(join(root, 'Shared'))
    session = await connect(entry, [JSON.stringify({ directories: [shared.path], disabledTools: [], gitExecutable: await findGit() })], { env: { MOSS_SESSION_WORKSPACE: workspace } })
    await expect(call(session.client, 'git_status')).rejects.toThrow('not a git repository')
    expect(await call(session.client, 'git_status', { repo_path: 'Nested' })).toContain('main')
    const outside = await seedRepository(join(root, 'Outside'))
    await symlink(outside.path, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(call(session.client, 'git_status', { repo_path: 'escape' })).rejects.toThrow('未在 Git App 中授权')
    expect(nested.git(['status', '--porcelain'])).toBe('')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
}, 30_000)

test('rejects unconfigured repositories, path traversal and Git argument injection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-scope-')); let session
  try {
    const repo = await seedRepository(join(root, 'allowed')), outside = await seedRepository(join(root, 'outside'))
    session = await connect(entry, [JSON.stringify({ directories: [repo.path], disabledTools: [], gitExecutable: await findGit() })], { env: { GIT_DIR: join(outside.path, '.git'), GIT_WORK_TREE: outside.path } })
    const client = session.client
    await expect(call(client, 'git_status', { repo_path: outside.path })).rejects.toThrow('未在 Git App 中授权')
    for (const files of [['../outside/note.txt'], [join(outside.path, 'note.txt')]]) {
      await expect(call(client, 'git_add', { repo_path: repo.path, files })).rejects.toThrow('超出当前仓库')
    }
    await symlink(outside.path, join(repo.path, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(call(client, 'git_add', { repo_path: repo.path, files: ['escape/note.txt'] })).rejects.toThrow('符号链接')
    await expect(call(client, 'git_show', { repo_path: repo.path, revision: '--output=bad' })).rejects.toThrow('Invalid Git reference')
    await expect(call(client, 'git_checkout', { repo_path: repo.path, branch_name: '--orphan=bad' })).rejects.toThrow('Invalid Git reference')
    await expect(call(client, 'git_log', { repo_path: repo.path, max_count: 100000 })).rejects.toThrow()
    await writeFile(join(repo.path, '-A'), 'literal path\n')
    await call(client, 'git_add', { repo_path: repo.path, files: ['-A'] })
    expect(repo.git(['diff', '--cached', '--name-only'])).toBe('-A')
    expect(outside.git(['status', '--porcelain'])).toBe('')
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }) }
}, 30_000)
