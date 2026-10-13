import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
export function parseSystemProxy(text) {
  const field = name => text.match(new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)`, 'm'))?.[1]
  const result = {}
  for (const [key, prefix] of [['HTTP_PROXY','HTTP'],['HTTPS_PROXY','HTTPS']]) {
    const host = field(`${prefix}Proxy`), port = Number(field(`${prefix}Port`))
    if (field(`${prefix}Enable`) === '1' && /^[a-zA-Z0-9.-]+$/.test(host || '') && Number.isInteger(port) && port > 0 && port < 65536) result[key] = `http://${host}:${port}`
  }
  return result
}
export async function engineEnvironment(env = process.env) {
  let proxy = {}
  if (process.platform === 'darwin' && !env.HTTPS_PROXY && !env.https_proxy) {
    try { proxy = parseSystemProxy((await execute('/usr/sbin/scutil', ['--proxy'], { timeout: 2000, maxBuffer: 16000 })).stdout) } catch {}
  }
  return { ...env, ...proxy, NO_PROXY: [env.NO_PROXY || env.no_proxy || '', '127.0.0.1','localhost','::1'].filter(Boolean).join(',') }
}
