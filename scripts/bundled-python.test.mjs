import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { buildPythonBundle } from './bundled-python.mjs'

const candidates = [process.env.MOSS_BUILD_PYTHON, process.env.MOSS_PYTHON_PATH,
  path.join(os.homedir(), '.moss/runtimes/python/versions/3.13.15/bin/python3'),
  process.platform === 'win32' ? 'python' : 'python3'].filter(Boolean)
const python = candidates.find(command => spawnSync(command, ['-I', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' }).stdout?.trim() === '3.13')

test('packaged launcher uses only App libraries and rejects incompatible or missing bundles', { skip: !python }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-bundled-python-'))
  try {
    await fs.copyFile(new URL('./bundled-python-launch.py', import.meta.url), path.join(root, 'launch.py'))
    const libraries = path.join(root, 'site-packages')
    await fs.mkdir(libraries)
    await fs.writeFile(path.join(libraries, 'fixture.py'), `import sys, json, importlib.util
assert sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode
assert importlib.util.find_spec('pip') is None
print(json.dumps(sys.argv[1:]))
`)
    const manifest = { python: '3.13', module: 'fixture', platform: `${process.platform}-${process.arch}` }
    const write = value => fs.writeFile(path.join(root, 'python-bundle.json'), JSON.stringify(value))
    const args = ['-I', '-S', '-B', path.join(root, 'launch.py'), 'directory with spaces', '中文']
    await write(manifest)
    assert.deepEqual(JSON.parse(execFileSync(python, args, { encoding: 'utf8' })), args.slice(-2))
    assert.deepEqual(await fs.readdir(libraries), ['fixture.py'], 'launch must not write caches into App code')
    await write({ ...manifest, python: '0.0' })
    assert.match(spawnSync(python, args, { encoding: 'utf8' }).stderr, /requires Moss Python/)
    await write({ ...manifest, platform: 'foreign-platform' })
    assert.match(spawnSync(python, args, { encoding: 'utf8' }).stderr, /different platform/)
    await write(manifest)
    await fs.rename(libraries, path.join(root, 'hidden-libraries'))
    assert.match(spawnSync(python, args, { encoding: 'utf8' }).stderr, /dependencies are missing/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('build refuses foreign native dependency targets before installing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-python-platform-'))
  try {
    await fs.mkdir(path.join(root, 'runtime'))
    await fs.writeFile(path.join(root, 'runtime/python.json'), JSON.stringify({ python: '3.13', module: 'fixture', requirements: ['fixture==1.0'], platforms: ['win32-x64', 'linux-x64'] }))
    const foreign = process.platform === 'win32' ? 'linux-x64' : 'win32-x64'
    await assert.rejects(buildPythonBundle(root, path.join(root, 'output'), foreign), /must be built on/)
    await assert.rejects(fs.stat(path.join(root, 'output')), { code: 'ENOENT' })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
