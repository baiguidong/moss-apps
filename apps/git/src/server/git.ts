import { execFile } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { absolutePath, within } from './paths'

export function gitEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_EDITOR: 'false', GIT_CONFIG_NOSYSTEM: '1' }
}
export async function findGit(configured = ''): Promise<string> {
  const name = process.platform === 'win32' ? 'git.exe' : 'git'
  const candidates = configured ? [absolutePath(configured)] : [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, name)),
    ...(process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', name)]
      : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']),
  ]
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return await realpath(candidate) } catch {}
  }
  throw new Error('未找到 Git。请安装 Git，或在设置中填写 Git 可执行文件的完整路径。')
}
export function runGit(executable: string, repo: string | undefined, args: string[], signal?: AbortSignal): Promise<string> {
  // GitPython's index commit bypasses hooks. Keep that behavior and disable
  // external diff/text conversion helpers in the Node adapter.
  const flags = ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + path.join(path.dirname(executable), '__moss_no_hooks__'), '-c', 'commit.gpgSign=false', '-c', 'color.ui=false']
  return new Promise((resolve, reject) => {
    execFile(executable, [...flags, ...(repo ? ['-C', repo] : []), ...args], {
      env: gitEnvironment(), encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'Git 输出超过 2 MiB，请缩小查询范围。'
          : error.killed ? 'Git 操作超时或已取消。' : stderr.trim() || error.message
        reject(new Error(message)); return
      }
      resolve(stdout.trimEnd())
    })
  })
}
export async function repository(executable: string, value: string, allowed?: string[], signal?: AbortSignal): Promise<string> {
  const canonical = await realpath(absolutePath(value))
  if (allowed && !allowed.includes(canonical)) throw new Error('该仓库未在 Git App 中授权。')
  const root = await realpath(await runGit(executable, canonical, ['rev-parse', '--show-toplevel'], signal))
  if (root !== canonical) throw new Error('请配置 Git 仓库根目录，不要填写仓库内的子目录。')
  return canonical
}
export async function sessionRepository(executable: string, value: string | undefined, allowed: string[], workspace: string | undefined, signal?: AbortSignal): Promise<string> {
  const base = workspace || allowed[0]
  if (!value && !base) throw new Error('请在会话中使用 Git，或在 App 设置中添加仓库目录。')
  const target = value
    ? path.isAbsolute(value) || /^~([\\/]|$)/.test(value) ? absolutePath(value)
      : base ? path.resolve(base, value) : absolutePath(value)
    : base!
  const canonical = await realpath(target)
  const authorized = (directory: string) => allowed.includes(directory) || Boolean(workspace && within(workspace, directory))
  if (!authorized(canonical)) throw new Error('该仓库未在 Git App 中授权，也不在当前会话工作目录内。')
  const root = await realpath(await runGit(executable, canonical, ['rev-parse', '--show-toplevel'], signal))
  if (!authorized(root)) throw new Error('Git 仓库根目录超出当前会话工作目录，请在 App 设置中添加该仓库。')
  return root
}
export async function stagePath(repo: string, value: string): Promise<string> {
  const target = path.resolve(repo, value)
  if (!within(repo, target)) throw new Error('暂存路径超出当前仓库。')
  let existing = target
  while (true) {
    try {
      if (!within(repo, await realpath(existing))) throw new Error('暂存路径通过符号链接指向仓库外。')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
  return path.relative(repo, target) || '.'
}
