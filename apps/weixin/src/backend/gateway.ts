import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { AppServiceError, type AppBackendContext } from '@moss/app-sdk'

const execute = promisify(execFile)
const worker = fileURLToPath(new URL('./gateway/bridge.py', import.meta.url))
const requirements = fileURLToPath(new URL('./requirements.lock', import.meta.url))
let preparation: Promise<{ python: string; site: string }> | undefined

async function prepare(context: AppBackendContext) {
  const runtime = await context.host.request('moss.runtimes/v1', 'python.get', {}, { timeoutMs: 120_000 })
  if (!runtime.available || !runtime.path) {
    throw new AppServiceError('PYTHON_UNAVAILABLE', 'Moss 内置 Python 尚未就绪')
  }
  const hash = createHash('sha256').update(await readFile(requirements)).digest('hex').slice(0, 16)
  const site = join(context.dataDir, 'gateway', `${runtime.version || 'python'}-${hash}`)
  const marker = join(site, '.ready')
  if (await readFile(marker, 'utf8').catch(() => '') !== hash) {
    await rm(site, { recursive: true, force: true })
    await mkdir(site, { recursive: true })
    try {
      await execute(runtime.path, [
        '-I', '-m', 'pip', '--isolated', 'install', '--require-hashes', '--only-binary=:all:',
        '--no-deps', '--disable-pip-version-check', '--no-input', '--no-compile',
        '--target', site, '-r', requirements,
      ], { timeout: 20 * 60_000, windowsHide: true })
    } catch {
      throw new AppServiceError('PYTHON_DEPENDENCIES', '微信通道依赖安装失败，请检查网络后重试')
    }
    await writeFile(marker, hash)
  }
  return { python: runtime.path, site }
}

export type GatewayEvent = Record<string, unknown>

export async function launchGateway(
  context: AppBackendContext,
  config: Record<string, unknown>,
  onEvent: (event: GatewayEvent) => void,
  { login = false, signal }: { login?: boolean; signal?: AbortSignal } = {},
) {
  preparation ??= prepare(context).catch(error => {
    preparation = undefined
    throw error
  })
  const { python, site } = await preparation
  signal?.throwIfAborted()
  const child = spawn(python, ['-I', '-S', '-B', worker, site, ...(login ? ['--login'] : [])], {
    stdio: 'pipe', windowsHide: true, signal,
  })
  child.stdin.on('error', () => {})
  child.stderr.resume()
  const output = createInterface({ input: child.stdout })
  output.on('line', line => {
    try {
      onEvent(JSON.parse(line))
    } catch {
      // The Python SDK can write diagnostics alongside the bridge output.
    }
  })
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  write(child, config)
  return { child, done }
}

export function write(child: ChildProcessWithoutNullStreams, message: unknown) {
  if (child.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n')
}
