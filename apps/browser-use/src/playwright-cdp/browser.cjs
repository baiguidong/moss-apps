// Browser Use attaches to a user's browser. It must never launch a persistent or
// isolated automation profile, including when an old CDP endpoint is unavailable.
function option(args, name) {
  let value
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1] && !args[index + 1].startsWith('--')) value = args[index + 1]
    else if (args[index].startsWith(`${name}=`)) value = args[index].slice(name.length + 1)
  }
  return value
}

function connectionArgs(args, env = process.env) {
  if (args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) return args
  const cdp = option(args, '--cdp-endpoint') || env.PLAYWRIGHT_MCP_CDP_ENDPOINT
  const endpoint = option(args, '--endpoint') || env.PLAYWRIGHT_MCP_ENDPOINT
  if (cdp || endpoint) return args // Connect only; there is deliberately no local auto-start fallback.
  if (args.includes('--isolated') || ['true', '1'].includes(env.PLAYWRIGHT_MCP_ISOLATED)) {
    throw new Error('网页操控连接日常使用的 Chrome，不支持 --isolated。请使用 Chrome 扩展连接。')
  }
  if (option(args, '--config') || env.PLAYWRIGHT_MCP_CONFIG) {
    throw new Error('请通过网页操控的连接设置配置 Chrome 扩展或 CDP 地址；不支持可能启动独立浏览器的 --config。')
  }
  return args.includes('--extension') ? args : ['--extension', ...args]
}

// Custom executables bypass Playwright's own installed-profile check. Validate
// their directory ourselves before handing any launch arguments to Playwright.
async function validateExtensionProfile(args, env = process.env) {
  if (args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))
    || option(args, '--cdp-endpoint') || env.PLAYWRIGHT_MCP_CDP_ENDPOINT
    || option(args, '--endpoint') || env.PLAYWRIGHT_MCP_ENDPOINT) return args
  const directory = option(args, '--user-data-dir') || env.PLAYWRIGHT_MCP_USER_DATA_DIR || env.PWTEST_EXTENSION_USER_DATA_DIR
  const executable = option(args, '--executable-path') || env.PLAYWRIGHT_MCP_EXECUTABLE_PATH
  if (!directory) {
    if (executable) throw new Error('自定义 Chrome 路径时，请同时填写已安装 Playwright 扩展的现有 Chrome 用户目录。')
    return args // The standard Chrome path is checked by Playwright itself.
  }
  const fs = require('node:fs/promises'), path = require('node:path')
  const extensionId = 'mmlmfjhmonkocbjadbfplnigmagldckm'
  const selected = option(args, '--profile-dir-name') || env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME
  const safeName = name => name && name !== '.' && name !== '..' && !/[/\\]/.test(name)
  if (selected && !safeName(selected)) throw new Error('Chrome 用户配置必须是现有目录名，例如 Default 或 Profile 1。')
  const profiles = selected ? [selected] : (await fs.readdir(directory).catch(() => [])).filter(name => name === 'Default' || /^Profile \d+$/.test(name))
  if (!selected) {
    const rank = name => name === 'Default' ? -1 : Number(name.slice(8))
    profiles.sort((a, b) => rank(a) - rank(b))
    const lastUsed = await fs.readFile(path.join(directory, 'Local State'), 'utf8').then(JSON.parse).then(state => state.profile?.last_used).catch(() => null)
    if (profiles.includes(lastUsed)) profiles.unshift(...profiles.splice(profiles.indexOf(lastUsed), 1))
  }
  const withProfile = name => {
    const kept = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--profile-dir-name') { i++; continue }
      if (!args[i].startsWith('--profile-dir-name=')) kept.push(args[i])
    }
    return [...kept, '--profile-dir-name', name]
  }
  for (const name of profiles) {
    const profile = path.join(directory, name)
    let preferences
    for (const file of ['Preferences', 'Secure Preferences']) {
      const parsed = await fs.readFile(path.join(profile, file), 'utf8').then(JSON.parse).catch(() => null)
      if (!parsed || typeof parsed !== 'object') continue
      preferences = parsed
      const record = parsed.extensions?.settings?.[extensionId]
      if (record && typeof record === 'object' && Object.keys(record).length) return withProfile(name)
    }
    if (preferences && (await fs.readdir(path.join(profile, 'Extensions', extensionId)).catch(() => [])).length) return withProfile(name)
  }
  throw new Error('未找到已安装 Playwright 扩展的现有 Chrome 用户配置。请检查用户目录和配置名称；Moss 不会创建新的 Chrome 用户目录。')
}

module.exports = { connectionArgs, validateExtensionProfile }
