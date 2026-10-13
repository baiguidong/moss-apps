import { expect, test } from 'bun:test'
import { browserFields, configFromFields, connectionTarget, DEFAULT_CONFIG, migrateLegacyBrowserConfig } from '../src/browser-config'

test('structured edits preserve other options, credentials and paths containing spaces', () => {
  const config = { ...DEFAULT_CONFIG, args: ['playwright-cdp/cli.cjs', '--extension', '--executable-path=/Applications/Custom Chrome', '--headless', '--timeout-action', '7000'], env: { TOKEN: '' } }
  const fields = browserFields(config)
  expect(fields['--executable-path']).toBe('/Applications/Custom Chrome')
  fields['--user-data-dir'] = '~/My Browser'
  const saved = configFromFields(config, fields, 'browser_close\nbrowser_resize')
  expect(saved.env).toEqual({ TOKEN: '', MOSS_BROWSER_CONNECTION_MODE: 'extension' })
  expect(saved.args).toContain('~/My Browser')
  expect(browserFields(saved).extra).toBe('--headless\n--timeout-action\n7000')
  expect(saved.disabledTools).toEqual(['browser_close', 'browser_resize'])
})
test('rejects invalid addresses and duplicate structured options, masks URL secrets in summaries', () => {
  const fields = browserFields(DEFAULT_CONFIG)
  expect(() => configFromFields(DEFAULT_CONFIG, { ...fields, mode: 'cdp', '--cdp-endpoint': 'file:///etc' }, '')).toThrow('CDP')
  expect(() => configFromFields(DEFAULT_CONFIG, { ...fields, extra: '--cdp-endpoint=http://example.com' }, '')).toThrow('对应字段')
  expect(() => configFromFields(DEFAULT_CONFIG, { ...fields, mode: 'extension', '--executable-path': '/custom/chrome' }, '')).toThrow('现有 Chrome 用户目录')
  expect(connectionTarget({ type: 'stdio', args: ['--cdp-endpoint', 'https://user:secret@example.com/cdp?token=hidden'] })).toBe('https://example.com')
})

test('defaults to managed Chrome for Testing and allows selecting the existing Chrome', () => {
  const fields = browserFields(DEFAULT_CONFIG)
  expect(fields.mode).toBe('managed')
  expect(DEFAULT_CONFIG.args).toContain('--moss-managed-browser')
  expect(DEFAULT_CONFIG.args).not.toContain('--user-data-dir')
  expect(connectionTarget(DEFAULT_CONFIG)).toBe('Moss 专用 · 保留登录状态')
  const saved = configFromFields(DEFAULT_CONFIG, { ...fields, mode: 'extension' }, '')
  expect(saved.args).toContain('--extension')
  expect(saved.args).not.toContain('--cdp-endpoint')
  expect(saved.args).not.toContain('--user-data-dir')
  expect(connectionTarget(saved)).toBe('系统 Chrome · 已有用户配置')
})

test('migrates the former local default once while preserving unrelated options and credentials', () => {
  for (const endpoint of ['http://127.0.0.1:9222', 'http://localhost:9222/']) {
    const old = { ...DEFAULT_CONFIG, args: ['/old/playwright-cdp/cli.cjs', `--cdp-endpoint=${endpoint}`, '--user-data-dir', '~/.moss/browser-profiles/playwright-cdp-9222', '--output-dir', '~/My Output', '--timeout-action', '7000'], env: { TOKEN: '' }, disabledTools: ['browser_close'] }
    const migrated = migrateLegacyBrowserConfig(old)
    expect(migrated.args).toEqual(['playwright-cdp/cli.cjs', '--moss-managed-browser', '--output-dir', '~/My Output', '--timeout-action', '7000'])
    expect(migrated.env).toEqual(old.env)
    expect(migrated.disabledTools).toEqual(old.disabledTools)
    expect(migrateLegacyBrowserConfig(migrated)).toEqual(migrated)
  }
})

test('preserves custom, authenticated, remote, environment and explicitly selected CDP connections', () => {
  for (const endpoint of ['http://localhost:9444', 'https://remote.example/cdp', 'ws://127.0.0.1:9222/devtools/browser/a', 'http://user:pass@localhost:9222', 'http://localhost:9222/proxy', 'http://localhost:9222/?token=secret']) {
    const config = { ...DEFAULT_CONFIG, args: ['playwright-cdp/cli.cjs', '--cdp-endpoint', endpoint] }
    expect(migrateLegacyBrowserConfig(config)).toBe(config)
  }
  const custom = { ...DEFAULT_CONFIG, args: ['playwright-cdp/cli.cjs', '--cdp-endpoint', 'http://localhost:9222', '--user-data-dir', '~/Custom Profile'] }
  expect(migrateLegacyBrowserConfig(custom)).toBe(custom)
  const env = { ...DEFAULT_CONFIG, env: { PLAYWRIGHT_MCP_CDP_ENDPOINT: 'http://localhost:9222' } }
  expect(migrateLegacyBrowserConfig(env)).toBe(env)
  const selected = configFromFields(DEFAULT_CONFIG, { ...browserFields(DEFAULT_CONFIG), mode: 'cdp', '--cdp-endpoint': 'http://127.0.0.1:9222' }, '')
  expect(migrateLegacyBrowserConfig(selected)).toBe(selected)
  expect(selected.args).not.toContain('--extension')
  for (const name of ['MOSS_BROWSER_CONNECTION_MODE', 'PLAYWRIGHT_MCP_CDP_ENDPOINT', 'PLAYWRIGHT_MCP_USER_DATA_DIR']) {
    const redacted = { ...selected, env: { [name]: '' } }
    expect(migrateLegacyBrowserConfig(redacted)).toBe(redacted)
  }
})

test('legacy default migration removes executable and profile launch overrides', () => {
  for (const overrides of [
    ['--executable-path', '/custom/chrome', '--profile-dir-name', 'Profile 1'],
    ['--executable-path=/custom/chrome', '--profile-dir-name=Profile 1'],
  ]) {
    const config = { ...DEFAULT_CONFIG, args: ['playwright-cdp/cli.cjs', '--cdp-endpoint', 'http://localhost:9222', ...overrides, '--output-dir', '~/Output'] }
    const migrated = migrateLegacyBrowserConfig(config)
    expect(migrated.args).toEqual(['playwright-cdp/cli.cjs', '--moss-managed-browser', '--output-dir', '~/Output'])
    expect(migrateLegacyBrowserConfig(migrated)).toEqual(migrated)
    const explicit = { ...config, env: { MOSS_BROWSER_CONNECTION_MODE: '' } }
    expect(migrateLegacyBrowserConfig(explicit)).toBe(explicit)
    const brokenManaged = { ...config, args: ['playwright-cdp/cli.cjs', '--moss-managed-browser', ...overrides, '--cdp-endpoint', 'http://localhost:9444'], env: { MOSS_BROWSER_CONNECTION_MODE: '' } }
    expect(migrateLegacyBrowserConfig(brokenManaged).args).toEqual(['playwright-cdp/cli.cjs', '--moss-managed-browser', '--cdp-endpoint', 'http://localhost:9444'])
  }
})

test('switching to the daily Chrome clears old connection overrides and keeps the chosen profile', () => {
  const config = { ...DEFAULT_CONFIG, env: { PLAYWRIGHT_MCP_CDP_ENDPOINT: 'http://localhost:9222', PLAYWRIGHT_MCP_ISOLATED: 'true', PLAYWRIGHT_MCP_ENDPOINT: 'ws://localhost/bound', TOKEN: '' } }
  expect(browserFields(config)['--cdp-endpoint']).toBe('http://localhost:9222')
  const fields = { ...browserFields(config), mode: 'extension' as const, '--profile-dir-name': 'Profile 1' }
  const saved = configFromFields(config, fields, '')
  expect(saved.env).toEqual({ TOKEN: '', MOSS_BROWSER_CONNECTION_MODE: 'extension' })
  expect(saved.args).toContain('Profile 1')
  expect(saved.args).not.toContain('--cdp-endpoint')
})

test('extension token is stored as an environment secret and a blank edit preserves it', () => {
  const fields = { ...browserFields(DEFAULT_CONFIG), mode: 'extension' as const, extensionToken: 'fixture-token' }
  const saved = configFromFields(DEFAULT_CONFIG, fields, '')
  expect(saved.env?.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe('fixture-token')
  expect(saved.args).not.toContain('fixture-token')
  const redacted = { ...saved, env: { ...saved.env, PLAYWRIGHT_MCP_EXTENSION_TOKEN: '' } }
  expect(browserFields(redacted).extensionToken).toBe('')
  expect(configFromFields(redacted, browserFields(redacted), '').env).toHaveProperty('PLAYWRIGHT_MCP_EXTENSION_TOKEN', '')
})
