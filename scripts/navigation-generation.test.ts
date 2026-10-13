import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRepositoryAppManifest } from './lib.mjs'

for (const [name, generator] of [['workflow', 'generate-schemas.ts'], ['computer-use', 'generate-contract.ts']]) {
  test(`${name} schema generation preserves navigation, groups and the minimum Host version`, async () => {
    const source = fileURLToPath(new URL(`../apps/${name}/`, import.meta.url))
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-navigation-generation-'))
    try {
      for (const file of ['app.moss.json', 'package.json']) await fs.copyFile(path.join(source, file), path.join(temp, file))
      await fs.cp(path.join(source, 'schemas'), path.join(temp, 'schemas'), { recursive: true })
      await fs.mkdir(path.join(temp, 'assets'))
      const before = JSON.parse(await fs.readFile(path.join(temp, 'app.moss.json'), 'utf8'))
      const result = Bun.spawnSync([process.execPath, path.join(source, 'scripts', generator)], { cwd: temp })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      const after = validateRepositoryAppManifest(JSON.parse(await fs.readFile(path.join(temp, 'app.moss.json'), 'utf8')))
      expect(after.navigation).toEqual(before.navigation)
      expect(after.hostApi).toBe(before.hostApi)
      expect(after.category).toBe(before.category)
      expect(after.keywords).toEqual(before.keywords)
      expect(after.contributes?.settings.map(item => item.group) || []).toEqual(before.contributes?.settings?.map((item: any) => item.group) || [])
    } finally { await fs.rm(temp, { recursive: true, force: true }) }
  })
}
