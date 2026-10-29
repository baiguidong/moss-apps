import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

export async function scaffold({ dest, id, name }) {
  if (!dest || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id || '') || !name?.trim()) throw new Error('Provide --dest, --id (publisher.name) and --name')
  const root = path.resolve(dest)
  await fs.access(path.join(root, '.moss-sdk/packages/app-sdk/src/index.mjs'))
  const { validateAppManifest } = await import(pathToFileURL(path.join(root, '.moss-sdk/packages/app-sdk/src/index.mjs')))
  const template = JSON.parse(await fs.readFile(new URL('./app.moss.json', import.meta.url), 'utf8'))
  const manifest = validateAppManifest({ ...template, id, displayName: name.trim() }, { requireNavigation: true })
  const pkg = { name: id, version: manifest.version, private: true, type: 'module', scripts: { build: 'node build.mjs' } }
  const json = value => JSON.stringify(value, null, 2) + '\n'
  const files = {
    'app.moss.json': json(manifest),
    'package.json': json(pkg),
    'package-lock.json': json({ name: id, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: id, version: pkg.version } } }),
    'schemas/text.json': json({ type: 'object', properties: { text: { type: 'string', maxLength: 100000 } }, required: ['text'], additionalProperties: false }),
    'src/main.mjs': `import { AppBackendClient } from '../sdk/packages/app-sdk/src/index.mjs'\nconst backend = new AppBackendClient()\nbackend.registerAction('text_stats', async ({ text }) => {\n  if (typeof text !== 'string' || text.length > 100000) throw new Error('text must be a string of at most 100000 characters')\n  return { characters: [...text].length, lines: text ? text.split(/\\r\\n|\\r|\\n/).length : 0 }\n})\nbackend.start()\n`,
    'build.mjs': `import fs from 'node:fs/promises'\nawait fs.mkdir('dist/backend', { recursive: true })\nawait fs.cp('.moss-sdk', 'dist/sdk', { recursive: true })\nawait fs.copyFile('src/main.mjs', 'dist/backend/main.mjs')\n`,
  }
  // Preflight all targets before writing; exclusive writes also catch races.
  for (const file of Object.keys(files)) {
    try { await fs.lstat(path.join(root, file)); throw new Error('Refusing to overwrite ' + file) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const written = []
  try {
    for (const [file, content] of Object.entries(files)) {
      const output = path.join(root, file)
      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.writeFile(output, content, { flag: 'wx' }); written.push(output)
    }
  } catch (error) { for (const file of written) await fs.unlink(file); throw error }
  return { path: root, appId: id, files: Object.keys(files) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { dest: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' } } })
  console.log(JSON.stringify(await scaffold(values)))
}
