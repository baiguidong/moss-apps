// Run the packaged service directly, including on Hosts that do not yet expand ~/.
const { homedir } = require('node:os')
const path = require('node:path')
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
require('./browser.cjs').ensureBrowser(process.argv.slice(2)).then(() => {
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
