import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
export const appRoot = fileURLToPath(new URL('..', import.meta.url))
const upstream = path.dirname(require.resolve('takt/package.json'))
if (JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'))).version !== '0.70.0') throw new Error('TAKT version must be 0.70.0')
const aliases = {
  '@takt/engine': 'core/workflow/engine/WorkflowEngine.js',
  '@takt/validator': 'core/workflow/engine/WorkflowValidator.js',
  '@takt/rules': 'core/models/workflow-rule-condition.js',
  '@takt/prompt': 'agents/runner-prompt.js',
}

// Build-time integration seam. Never modify an installed TAKT package or its scheduler.
export const taktPlugin = {
  name: 'moss-takt-0.70.0',
  setup(builder) {
    builder.onResolve({ filter: /^@takt\// }, args => ({ path: path.join(upstream, 'dist', aliases[args.path] ?? 'INVALID') }))
    builder.onLoad({ filter: /\.js$/ }, async args => {
      if (!args.path.startsWith(upstream + path.sep)) return
      const relative = path.relative(upstream, args.path).replaceAll(path.sep, '/')
      if (relative === 'dist/agents/runner.js') return { contents: `export { runAgent, AgentRunner } from ${JSON.stringify(path.join(appRoot, 'src/engine/runner.mjs'))}`, loader: 'js' }
      if (relative === 'dist/infra/providers/index.js') return { contents: `export { getProvider } from ${JSON.stringify(path.join(appRoot, 'src/engine/runner.mjs'))}`, loader: 'js' }
      if (relative === 'dist/shared/types/provider.js') return { contents: fs.readFileSync(args.path, 'utf8').replace("export const PROVIDER_TYPES = [", "export const PROVIDER_TYPES = [\n    'moss',"), resolveDir: path.dirname(args.path) }
      if (relative === 'dist/infra/providers/provider-capabilities.js') return { contents: fs.readFileSync(args.path, 'utf8').replace('const ALLOWED_TOOLS_PROVIDERS = new Set([', "const ALLOWED_TOOLS_PROVIDERS = new Set(['moss',"), resolveDir: path.dirname(args.path) }
      if (relative === 'dist/infra/resources/index.js') return { contents: fs.readFileSync(args.path, 'utf8').replace("join(currentDir, '..', '..', '..', 'builtins')", "join(currentDir, 'takt-resources', 'builtins')"), resolveDir: path.dirname(args.path) }
      if (relative === 'dist/shared/prompts/index.js') return { contents: fs.readFileSync(args.path, 'utf8').replace('join(__dirname, lang,', "join(__dirname, 'takt-resources', 'prompts', lang,"), resolveDir: path.dirname(args.path) }
    })
  },
}

export async function buildBackend(entryPoints, outdir) {
  fs.mkdirSync(outdir, { recursive: true })
  const result = await build({ absWorkingDir: appRoot, entryPoints, outdir, bundle: true, platform: 'node', target: 'node22', format: 'esm', outExtension: { '.js': '.mjs' }, plugins: [taktPlugin], metafile: true, logLevel: 'warning', banner: { js: "import { createRequire as __mossCreateRequire } from 'node:module'; const require = __mossCreateRequire(import.meta.url);" } })
  const forbidden = Object.keys(result.metafile.inputs).filter(p => /node_modules\/(?:@anthropic-ai\/sdk|@openai\/codex-sdk|@anthropic-ai\/claude-agent-sdk|node-pty)\//.test(p))
  if (forbidden.length) throw new Error('Unexpected external agent dependency: ' + forbidden.join(', '))
  fs.cpSync(path.join(upstream, 'builtins'), path.join(outdir, 'takt-resources/builtins'), { recursive: true })
  for (const lang of ['en', 'ja']) fs.cpSync(path.join(upstream, 'dist/shared/prompts', lang), path.join(outdir, 'takt-resources/prompts', lang), { recursive: true })
  // The CLI wrapper owns automatic Git operations upstream; this App has no such wrapper.
  for (const lang of ['en', 'ja']) fs.copyFileSync(path.join(appRoot, 'resources/git-rules.md'), path.join(outdir, 'takt-resources/prompts', lang, 'parts/git_rules.md'))
  fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(outdir, 'takt-resources/LICENSE'))
  return result.metafile
}
