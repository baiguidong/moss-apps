import fs from 'node:fs/promises'
import path from 'node:path'

export async function analyzeSkill(input, workspace) {
  if (!workspace) throw new Error('Skill analysis requires an ordinary session workspace')
  const root = await fs.realpath(workspace), selected = await fs.realpath(path.resolve(root, input || ''))
  const relative = path.relative(root, selected)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Select Skill source inside the session workspace')
  const files = [], dependencies = new Set(), capabilities = new Set()
  let total = 0
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name) || entry.name.startsWith('.env')) continue
      if (entry.isSymbolicLink()) throw new Error('Skill source must not contain symlinks')
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { await visit(file); continue }
      if (!entry.isFile()) continue
      const stat = await fs.stat(file)
      total += stat.size
      if (files.length >= 500 || total > 2 * 1024 * 1024) throw new Error('Skill source exceeds static analysis limits')
      files.push(path.relative(selected, file))
      if (!/\.(?:md|json|py|[cm]?js|ts|sh|ya?ml|txt)$/.test(entry.name)) continue
      const text = await fs.readFile(file, 'utf8')
      for (const match of text.matchAll(/(?:import|from)\s+['"]?([@\w./-]+)/g)) dependencies.add(match[1])
      if (/https?:\/\//.test(text)) capabilities.add('external-service')
      if (/token|api[_ -]?key|password|credential/i.test(text)) capabilities.add('credentials')
      if (/subprocess|exec\(|spawn\(|\bCLI\b/i.test(text)) capabilities.add('external-command')
      if (/writeFile|open\(.+['"]w|mkdir/.test(text)) capabilities.add('file-write')
    }
  }
  await visit(selected)
  if (!files.includes('SKILL.md')) throw new Error('Selected directory has no SKILL.md')
  return { files, dependencies: [...dependencies], capabilities: [...capabilities], scriptsExecuted: 0, status: 'analysis-only', verification: 'Implement and test the real App behavior; external dependencies are not verified by static analysis.' }
}
