import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileJsonSchema } from '@moss/app-sdk'

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const backendSource = readFileSync(new URL('../backend/feishu/index.ts', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../../app.moss.json', import.meta.url), 'utf8'))
const configSchema = JSON.parse(readFileSync(new URL('../../schemas/config.json', import.meta.url), 'utf8'))

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
    ]) {
      expect(source.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1)
    }
  })

  test('preserves unavailable resource selections and reports the real connection state', () => {
    expect(source).toContain('（当前不可用）')
    expect(source).toContain('dirtyResourceKinds')
    expect(source).toContain('status.transportError')
    expect(source).toContain('飞书 App 未启用')
    expect(source).toContain(".filter((entry) => String(entry || '') !== String(userId))")
    expect(source).toContain('requestVersion !== statusRequestVersion')
  })

  test('keeps Feishu private chats automatic and only exposes execution limits', () => {
    for (const id of ['streamingCard', 'replyMode', 'agentId', 'sessionMode', 'rotateAfterTurns', 'memberPolicies', 'reviewList']) {
      expect(source).not.toContain(`id="${id}"`)
    }
    expect(configSchema.properties).not.toHaveProperty('streamingCard')
    expect(configSchema.additionalProperties).toBe(false)
    for (const scope of ['im:message.p2p_msg:readonly', 'im:message:send_as_bot', 'im:message']) {
      expect(source).toContain(scope)
    }
    expect(source).not.toContain('im:resource')
    expect(source).not.toContain('cardkit:card:write')
    expect(source).toContain("replyMode: 'ai_auto'")
    expect(source).toContain("session: { mode: 'fixed'")
    expect(source).toContain('normalizeAutomaticPolicy(binding)')
    expect(source).toContain("kinds: ['tools', 'skills', 'connectors']")
    expect(source).toContain('id="permissionMode"')
    expect(source).toContain('id="unrestrictedResources"')
    expect(manifest.permissions).toEqual([
      'agent:catalog:read',
      'agent:bindings:read',
      'agent:bindings:write',
      'agent:turns:read',
      'agent:turns:write',
    ])
    expect(manifest.backend).not.toHaveProperty('targets')
    expect(manifest.backend.protocols).toEqual(['moss.agent/v1'])
    expect(source).not.toContain("'server'")
    expect(backendSource).not.toContain("'server'")
    expect(backendSource).toContain("if (chatType !== 'p2p') return")
    expect(backendSource).toContain("hostBridge.on('turn.completed'")
    expect(backendSource).toContain("hostBridge.registerAction('pairing.issue'")
    expect(backendSource).toContain("msg_type: 'text'")
    for (const removed of [
      'StreamingCard',
      'conversation.list',
      'conversation.new',
      'conversation.select',
      'session.abort',
      'card.action.trigger',
      'application.bot.menu_v6',
      'notification.deliver',
      'decision.resolved',
      'turn.review_requested',
    ]) {
      expect(backendSource).not.toContain(removed)
    }
  })

  test('rejects fields outside the current configuration contract', () => {
    const invalidConfig = { appId: 'cli_example', streamingCard: false, allowedUsers: [] }
    const validate = compileJsonSchema(configSchema)

    expect(validate(invalidConfig)).toBe(false)
    expect(validate({ appId: 'cli_example', allowedUsers: [] })).toBe(true)
  })
})
