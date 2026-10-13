// Run the packaged service directly, including on Hosts that do not yet expand ~/.
const { homedir } = require('node:os')
const path = require('node:path')
// System proxies commonly bypass 127.* but not [::1]. Keep the extension relay
// on IPv4 loopback without changing Chrome or the customer's proxy settings.
require('node:dns').setDefaultResultOrder('ipv4first')
function expand(value) {
  if (value === '~') return homedir()
  return value.startsWith('~/') || value.startsWith('~\\')
    ? path.join(homedir(), value.slice(2).replaceAll('\\', '/'))
    : value
}
process.argv = process.argv.map((arg, index) => {
  if (index < 2) return arg
  const option = arg.match(/^(--[\w-]+=)(.*)$/s)
  return option ? option[1] + expand(option[2]) : expand(arg)
})
Promise.resolve().then(async () => {
  let args = process.argv.slice(2)
  if (args.includes('--moss-managed-browser') && !args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) {
    const result = await require('./managed.cjs').createManagedEndpoint(args)
    process.stdin.once('end', result.close)
    process.once('exit', result.close)
    const kept = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--cdp-endpoint') { i++; continue }
      if (args[i] === '--moss-managed-browser' || args[i].startsWith('--cdp-endpoint=')) continue
      kept.push(args[i])
    }
    args = [...kept, '--cdp-endpoint', result.endpoint]
  } else args = args.filter(arg => arg !== '--moss-managed-browser')
  const { connectionArgs, validateExtensionProfile } = require('./browser.cjs')
  args = connectionArgs(args)
  args = await validateExtensionProfile(args)
  process.argv = [...process.argv.slice(0, 2), ...args]
  require('./node_modules/@playwright/mcp/cli.js')
}).catch(error => {
  console.error(`[playwright-cdp] ${error.message}`)
  // Report startup failures through MCP so existing Hosts can show an actionable error.
  const lines = require('node:readline').createInterface({ input: process.stdin })
  let answered = false
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (answered || message.method !== 'initialize' || message.id === undefined) return
    answered = true
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } }) + '\n', () => {
      lines.close(); process.stdin.destroy(); process.exitCode = 1
    })
  })
  lines.on('close', () => { process.exitCode = 1 })
  setTimeout(() => process.exit(1), 3000).unref()
})
