import { describe, expect, it } from 'bun:test'
import { FeishuAgentBridge } from './app-agent-bridge.js'
import { loadConfigFromAppContext } from './config.js'
import { createEnvelope, validateAgentHostInput } from '@moss/app-sdk'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Feishu App Host bridge', () => {
  it('does not report the App Backend ready until the transport is connected', async () => {
    const sent: any[] = []
    let receive: ((message: any) => void) | undefined
    const bridge = new FeishuAgentBridge({
      clientOptions: {
        send: (message: any) => sent.push(message),
        onMessage: (handler: (message: any) => void) => { receive = handler },
        onDisconnect: () => {},
      },
    })
    receive?.(createEnvelope('service.init', {
      appId: 'moss.feishu',
      version: '0.1.0',
      instanceId: 'moss.feishu--default',
      generation: 1,
      launchToken: 'launch-1',
      config: { appId: 'cli_app' },
      secrets: { appSecret: 'secret' },
      protocols: ['moss.agent/v1'],
      permissions: ['agent:turns:write'],
      grants: ['agent:turns:write'],
    }, { id: 'init-1' }))
    await tick()
    expect(sent.some((message) => message.type === 'service.ready')).toBe(false)
    bridge.ready()
    await tick()
    expect(sent.at(-1)).toMatchObject({ type: 'service.ready', id: 'init-1' })
    bridge.destroy()
  })

  it('uses the moss.agent/v1 request contract directly', () => {
    expect(validateAgentHostInput('turn.start', {
      externalUserId: 'ou_user',
      externalConversationId: 'oc_chat',
      externalEventId: 'om_message',
      text: 'hello',
    })).toMatchObject({ externalUserId: 'ou_user', externalConversationId: 'oc_chat' })
    expect(validateAgentHostInput('turn.delivery.ack', {
      turnId: 'turn-1', externalConversationId: 'chat-1', ok: true,
    })).toMatchObject({ turnId: 'turn-1' })
    expect(() => validateAgentHostInput('turn.delivery.ack', {
      turnId: 'turn-1', ok: true,
    })).toThrow('externalConversationId')
  })

  it('rejects spoofed member identities and unbounded message payloads', () => {
    const identity = {
      externalUserId: 'ou_user',
      externalConversationId: 'oc_chat',
      externalEventId: 'om_message',
    }
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      text: 'hello',
      externalMemberId: 'ou_other',
    })).toThrow(/unknown field: externalMemberId/)
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      text: 'hello',
      extra: true,
    })).toThrow(/unknown field: extra/)
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      attachments: Array.from({ length: 33 }, () => ({ type: 'image' })),
    })).toThrow(/at most 32/)
  })

  it('builds transport configuration only from scoped App init data', () => {
    const config = loadConfigFromAppContext({
      config: {
        appId: 'cli_app',
        allowedUsers: ['ou_allowed'],
      },
      secrets: {
        appSecret: 'secret', encryptKey: 'encrypt', verificationToken: 'verify',
      },
    })
    expect(config).toMatchObject({
      feishu: {
        appId: 'cli_app',
        appSecret: 'secret',
        encryptKey: 'encrypt',
        verificationToken: 'verify',
        allowedUsers: ['ou_allowed'],
      },
    })
  })
})
