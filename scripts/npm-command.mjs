import fs from 'node:fs'
import path from 'node:path'

export function npmInvocation({ platform = process.platform, executable = process.execPath, env = process.env } = {}) {
  if (platform !== 'win32') return { command: 'npm', args: [] }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH'
  const directories = [path.dirname(executable), ...(env[pathKey] || '').split(path.delimiter).filter(Boolean)]
  const candidates = [env.npm_execpath, ...directories.map(directory => path.join(directory, 'node_modules/npm/bin/npm-cli.js'))]
  const cli = candidates.find(candidate => candidate && path.basename(candidate) === 'npm-cli.js' && fs.existsSync(candidate))
  if (!cli) throw new Error('Cannot locate npm-cli.js. Install Node.js with npm and add its directory to PATH.')
  return { command: executable, args: [cli] }
}
