import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
export function collectLicenses(appRoot) {
  const seen = new Set(), notices = []
  function visit(name, parent) {
    const require = createRequire(join(parent, 'package.json'))
    const candidate = (require.resolve.paths(name) || []).map(directory => join(directory, name, 'package.json')).find(existsSync)
    if (!candidate) throw new Error(`Cannot locate dependency metadata: ${name}`)
    const packageFile = realpathSync(candidate)
    const info = JSON.parse(readFileSync(packageFile, 'utf8')), id = `${name}@${info.version}`
    if (seen.has(id)) return
    seen.add(id)
    const root = dirname(packageFile)
    if (!name.startsWith('@moss/')) {
      const files = readdirSync(root).filter(file => /^(license|licence|copying|notice)(\.|$)/i.test(file))
      if (!files.length) throw new Error(`Missing third-party license: ${id}`)
      notices.push(`${id}\n${files.map(file => readFileSync(join(root, file), 'utf8')).join('\n')}`)
    }
    for (const dependency of Object.keys(info.dependencies || {})) visit(dependency, root)
  }
  const app = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(app.dependencies)) visit(dependency, appRoot)
  mkdirSync(join(appRoot, 'dist/licenses'), { recursive: true })
  writeFileSync(join(appRoot, 'dist/licenses/THIRD_PARTY_NOTICES.txt'), notices.sort().join('\n\n--------------------\n\n') + '\n')
}
