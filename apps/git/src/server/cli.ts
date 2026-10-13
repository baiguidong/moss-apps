// Node adaptation of mcp-server-git 2026.8.18; see assets/licenses/README.md.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { resolveSettings } from './settings'
import { findGit, sessionRepository, runGit, stagePath } from './git'
import { directories } from './paths'

const settings = await resolveSettings(JSON.parse(process.argv[2] || '{}'))
const workspace = process.env.MOSS_SESSION_WORKSPACE
  ? (await directories([process.env.MOSS_SESSION_WORKSPACE]))[0] : undefined
const executable = await findGit(settings.gitExecutable)
const roots = [...new Set([...(workspace ? [workspace] : []), ...settings.directories])]
const base = { repo_path: z.string().min(1).optional().describe('Repository path. Defaults to the current session workspace; relative paths resolve there. An absolute path may select an additional repository configured in this App.') }
const revision = z.string().min(1).max(1024).refine(value => !value.startsWith('-') && !/[\x00\r\n]/.test(value), 'Invalid Git reference')
const context = { context_lines: z.number().int().min(0).max(100).default(3) }
const timestamp = z.string().min(1).max(128).refine(value => !value.startsWith('-') && !/[\x00\r\n]/.test(value), 'Invalid date')
const diffFlags = (lines: number) => ['--no-ext-diff', '--no-textconv', `--unified=${lines}`]
const git = (repo: string, args: string[], signal?: AbortSignal) => runGit(executable, repo, args, signal)
const ref = (repo: string, value: string, signal?: AbortSignal) => git(repo, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`], signal)
type Definition = { description: string; schema: z.ZodObject<any>; write?: boolean; destructive?: boolean; nonIdempotent?: boolean; run: (repo: string, args: any, signal: AbortSignal) => Promise<string> }
const definitions: Record<string, Definition> = {
  git_status: { description: 'Shows the working tree status.', schema: z.object(base).strict(),
    run: (repo, _args, signal) => git(repo, ['status'], signal) },
  git_diff_unstaged: { description: 'Shows changes that are not staged.', schema: z.object({ ...base, ...context }).strict(),
    run: (repo, args, signal) => git(repo, ['diff', ...diffFlags(args.context_lines), '--'], signal) },
  git_diff_staged: { description: 'Shows staged changes.', schema: z.object({ ...base, ...context }).strict(),
    run: (repo, args, signal) => git(repo, ['diff', '--cached', ...diffFlags(args.context_lines), '--'], signal) },
  git_diff: { description: 'Compares the working tree with a branch or commit.', schema: z.object({ ...base, ...context, target: revision }).strict(),
    run: async (repo, args, signal) => git(repo, ['diff', ...diffFlags(args.context_lines), await ref(repo, args.target, signal), '--'], signal) },
  git_commit: { description: 'Commits staged changes using the repository Git identity.', write: true, nonIdempotent: true,
    schema: z.object({ ...base, message: z.string().min(1).max(20_000).refine(value => !value.includes('\0')) }).strict(),
    run: async (repo, args, signal) => {
      await git(repo, ['commit', '--no-verify', '--no-gpg-sign', '-m', args.message], signal)
      return `Changes committed successfully with hash ${await ref(repo, 'HEAD', signal)}`
    } },
  git_add: { description: 'Stages literal file paths within the configured repository.', write: true,
    schema: z.object({ ...base, files: z.array(z.string().min(1).max(4096).refine(value => !value.includes('\0'))).min(1).max(1000) }).strict(),
    run: async (repo, args, signal) => {
      const files = await Promise.all(args.files.map((file: string) => stagePath(repo, file)))
      await git(repo, ['add', '--', ...files], signal); return 'Files staged successfully'
    } },
  git_reset: { description: 'Unstages all changes, preserving working-tree files.', write: true, destructive: true, schema: z.object(base).strict(),
    run: async (repo, _args, signal) => { await git(repo, ['reset', '--mixed', 'HEAD', '--'], signal); return 'All staged changes reset' } },
  git_log: { description: 'Shows recent commits with optional date filters.',
    schema: z.object({ ...base, max_count: z.number().int().min(1).max(1000).default(10), start_timestamp: timestamp.optional(), end_timestamp: timestamp.optional() }).strict(),
    run: (repo, args, signal) => git(repo, ['log', `--max-count=${args.max_count}`, '--format=Commit: %H%nAuthor: %an%nDate: %aI%nMessage: %B',
      ...(args.start_timestamp ? [`--since=${args.start_timestamp}`] : []), ...(args.end_timestamp ? [`--until=${args.end_timestamp}`] : []), '--'], signal) },
  git_create_branch: { description: 'Creates a branch without switching to it.', write: true, nonIdempotent: true,
    schema: z.object({ ...base, branch_name: revision, base_branch: revision.optional() }).strict(),
    run: async (repo, args, signal) => {
      await git(repo, ['check-ref-format', '--branch', args.branch_name], signal)
      const base = await ref(repo, args.base_branch || 'HEAD', signal)
      await git(repo, ['branch', '--', args.branch_name, base], signal); return `Created branch '${args.branch_name}'`
    } },
  git_checkout: { description: 'Switches to an existing branch or revision; does not force discard changes.', write: true, destructive: true,
    schema: z.object({ ...base, branch_name: revision }).strict(),
    run: async (repo, args, signal) => {
      await ref(repo, args.branch_name, signal)
      await git(repo, ['checkout', '--no-guess', args.branch_name, '--'], signal); return `Switched to '${args.branch_name}'`
    } },
  git_show: { description: 'Shows a commit and its changes.', schema: z.object({ ...base, revision }).strict(),
    run: async (repo, args, signal) => git(repo, ['show', '--no-ext-diff', '--no-textconv', await ref(repo, args.revision, signal), '--'], signal) },
  git_branch: { description: 'Lists local, remote or all branches with optional commit filters.',
    schema: z.object({ ...base, branch_type: z.enum(['local', 'remote', 'all']), contains: revision.optional(), not_contains: revision.optional() }).strict(),
    run: async (repo, args, signal) => git(repo, ['branch', '--list', ...(args.branch_type === 'all' ? ['--all'] : args.branch_type === 'remote' ? ['--remotes'] : []),
      ...(args.contains ? ['--contains', await ref(repo, args.contains, signal)] : []), ...(args.not_contains ? ['--no-contains', await ref(repo, args.not_contains, signal)] : [])], signal) },
}

const server = new Server({ name: 'moss-git', version: '0.1.0' }, { capabilities: { tools: {} } })
const queues = new Map<string, Promise<unknown>>()
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(definitions).map(([name, tool]) => ({
  name, description: `${tool.description}\nDefault directory: ${workspace || settings.directories[0] || 'Use in a session or configure a repository.'}\nAllowed directories (session workspace first; repositories inside it are supported):\n${roots.join('\n')}`,
  inputSchema: z.toJSONSchema(tool.schema) as { type: 'object' },
  annotations: { readOnlyHint: !tool.write, destructiveHint: Boolean(tool.destructive), idempotentHint: !tool.nonIdempotent, openWorldHint: false },
})) }))
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  try {
    const tool = Object.hasOwn(definitions, request.params.name) ? definitions[request.params.name] : undefined
    if (!tool) throw new Error('Unknown Git tool')
    const args = tool.schema.parse(request.params.arguments)
    const repo = await sessionRepository(executable, args.repo_path as string | undefined, settings.directories, workspace, extra.signal)
    const pending = (queues.get(repo) || Promise.resolve()).then(async () => {
      if (extra.signal.aborted) throw new Error('Git 操作已取消。')
      return tool.run(repo, args, extra.signal)
    })
    queues.set(repo, pending.catch(() => {}))
    return { content: [{ type: 'text', text: (await pending) || 'No changes.' }] }
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Git 操作失败。' }] }
  }
})
await server.connect(new StdioServerTransport())
