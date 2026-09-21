import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const backendSource = readFileSync(new URL('../backend/feishu/index.ts', import.meta.url), 'utf8')

describe('Feishu App UI contract', () => {
  test('uses the Moss appearance tokens without a separate Feishu color palette', () => {
    for (const token of [
      '--background',
      '--foreground',
      '--card',
      '--muted-foreground',
      '--primary',
      '--border',
      '--input',
      '--ring',
    ]) {
      expect(source).toContain(`${token}:`)
    }

    expect(source).not.toMatch(/--(?:bg|surface|text|primary-hover|primary-soft|success-soft|warning-soft|danger-soft|shadow)\s*:/)
    expect(source).not.toContain('#3370ff')
  })

  test('follows the host theme and background style at runtime', () => {
    expect(source).toContain('class="app-shell"')
    expect(source).toContain("data-background-style='grid-theme'")
    expect(source).toContain("data-background-style='dot-theme'")
    expect(source).toContain("data-background-style='gradient-theme'")
    expect(source).toContain('function refreshAppearance()')
    expect(source).toContain("root.dataset.backgroundStyle = next.cssThemeId")
    expect(source).toContain("window.addEventListener('focus', handleWindowFocus)")
    expect(source).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)")
    expect(source).toContain("systemColorScheme.addEventListener('change', handleSystemThemeChange)")
    expect(source).toContain("subscribeHostEvent('appearance'")
  })

  test('starts with settings and keeps each configuration control exactly once', () => {
    expect(source).not.toContain('<header>')
    expect(source).not.toContain('class="logo"')
    expect(source).not.toContain('留空则保持不变')

    for (const id of [
      'appId',
      'appSecret',
      'encryptKey',
      'verificationToken',
      'allowedUsers',
      'streamingCard',
      'runLocation',
    ]) {
      expect(source.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1)
    }
  })

  test('preserves unavailable AI selections and reports the real connection state', () => {
    expect(source).toContain('（当前不可用）')
    expect(source).toContain('dirtyResourceKinds')
    expect(source).toContain('status.transportError')
    expect(source).toContain('飞书 App 未启用')
    expect(source).toContain(".filter((entry) => String(entry || '') !== String(userId))")
    expect(source).toContain('requestVersion !== statusRequestVersion')
    expect(source).toContain('requestVersion !== draftsRequestVersion')
  })

  test('acknowledges accepted turns and uses stable ids for human handoff notices', () => {
    expect(backendSource).toContain("desktopBridge.on('turn.accepted', () => {})")
    expect(backendSource).toContain('`human-${result.turnId}`')
    expect(backendSource).toContain('`review-${turnId}`')
  })
})
