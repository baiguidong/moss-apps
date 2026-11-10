import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

// App-owned build metadata; the Host only sees an ordinary bundled MCP launcher.
export function pythonBundle(root) {
  const file = path.join(root, 'runtime/python.json')
  if (!fs.existsSync(file)) return null
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (config.python !== '3.13' || !/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(config.module)
    || !Array.isArray(config.requirements) || !config.requirements.length
    || config.requirements.some(value => !/^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9.!+_-]*$/.test(value))
    || !Array.isArray(config.platforms) || !config.platforms.length
    || config.platforms.some(value => !['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64', 'win32-arm64'].includes(value))) {
    throw new Error(`Invalid bundled Python definition: ${file}`)
  }
  return config
}

export function pythonBundleManifest(manifest, root) {
  const config = pythonBundle(root)
  return config ? { ...manifest, platforms: config.platforms } : manifest
}

function run(python, args, options = {}) {
  const result = spawnSync(python, args, { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) throw result.error || new Error(`Python bundle build failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

export async function buildPythonBundle(root, destination, target) {
  const config = pythonBundle(root)
  if (!config) return
  const platform = `${process.platform}-${process.arch}`
  if (target !== platform || !config.platforms.includes(platform)) throw new Error(`Python dependencies must be built on ${target}; current platform is ${platform}`)
  const candidates = [process.env.MOSS_BUILD_PYTHON, process.env.MOSS_PYTHON_PATH,
    path.join(os.homedir(), '.moss/runtimes/python/versions/3.13.15/bin/python3'),
    process.platform === 'win32' ? 'python' : 'python3'].filter(Boolean)
  let python
  for (const candidate of candidates) {
    try {
      if (run(candidate, ['-I', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])']) === config.python) { python = candidate; break }
    } catch { /* Try the next build interpreter. */ }
  }
  if (!python) throw new Error(`Building this App requires Python ${config.python}; set MOSS_BUILD_PYTHON`)
  const libraries = path.join(destination, 'site-packages')
  await fsp.mkdir(libraries, { recursive: true })
  // Wheels carry native libraries and licenses. Never ship a venv or interpreter.
  run(python, ['-I', '-m', 'pip', '--isolated', 'install', '--only-binary=:all:', '--no-compile',
    '--disable-pip-version-check', '--no-input', '--target', libraries, ...config.requirements])
  const packages = JSON.parse(run(python, ['-I', '-m', 'pip', 'list', '--path', libraries, '--format=json', '--disable-pip-version-check']))
  await fsp.writeFile(path.join(destination, 'python-bundle.json'), JSON.stringify({ ...config, platform, packages }, null, 2) + '\n')
  await fsp.copyFile(new URL('./bundled-python-launch.py', import.meta.url), path.join(destination, 'launch.py'))
  await fsp.writeFile(path.join(destination, 'launch.cjs'), `const path = require('node:path')
const { spawn } = require('node:child_process')
const python = process.env.MOSS_PYTHON_PATH
if (!python) throw new Error('Moss 内置 Python 尚未就绪，请启用内置 Python 运行环境。')
const child = spawn(python, ['-I', '-S', '-B', path.join(__dirname, 'launch.py'), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => { process.exitCode = code ?? 1 })
`)
}
