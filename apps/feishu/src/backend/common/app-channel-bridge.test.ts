import { describe, expect, it } from 'bun:test'
import {
  AppChannelBridge,
  mapChannelEventToLegacy,
  mapLegacyRequestToChannel,
} from './app-channel-bridge.js'
import { loadConfigFromAppContext } from './config.js'
import { createEnvelope, validateChannelHostInput } from '@moss/app-sdk'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Feishu App Channel compatibility bridge', () => {
  it('does not report the App Backend ready until the transport is connected', async () => {
    const sent: any[] = []
    let receive: ((message: any) => void) | undefined
    const bridge = new AppChannelBridge({
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
      protocols: ['moss.channel/v1'],
      permissions: ['channel:connection'],
      grants: ['channel:connection'],
    }, { id: 'init-1' }))
    await tick()
    expect(sent.some((message) => message.type === 'service.ready')).toBe(false)
    bridge.ready()
    await tick()
    expect(sent.at(-1)).toMatchObject({ type: 'service.ready', id: 'init-1' })
    bridge.destroy()
  })

  it('maps legacy request names and external identities to moss.channel/v1', () => {
    expect(mapLegacyRequestToChannel('chat.message.received', {
      openId: 'ou_user',
      chatId: 'oc_chat',
      eventId: 'om_message',
      text: 'hello',
    })).toEqual({
      method: 'message.receive',
      input: {
        externalUserId: 'ou_user',
        externalConversationId: 'oc_chat',
        externalEventId: 'om_message',
        text: 'hello',
      },
    })

    expect(mapLegacyRequestToChannel('conversation.new', {
      openId: 'ou_user', chatId: 'oc_chat', title: 'New',
    }, () => 'generated-event')).toMatchObject({
      method: 'conversation.create',
      input: {
        externalUserId: 'ou_user',
        externalConversationId: 'oc_chat',
        externalEventId: 'generated-event',
        title: 'New',
      },
    })
  })

  it('distinguishes terminal turn acknowledgements from notification deliveries', () => {
    expect(mapLegacyRequestToChannel('turn.delivery.ack', {
      turnId: 'turn-1', chatId: 'chat-1',
    })).toMatchObject({
      method: 'delivery.ack',
      input: {
        kind: 'turn',
        deliveryId: 'turn-1',
        externalConversationId: 'chat-1',
        ok: true,
      },
    })
    expect(mapLegacyRequestToChannel('delivery.ack', {
      deliveryId: 'delivery-1', messageId: 'message-1', ok: false,
    })).toMatchObject({
      method: 'delivery.ack',
      input: {
        kind: 'notification',
        deliveryId: 'delivery-1',
        externalMessageId: 'message-1',
        ok: false,
      },
    })
    expect(validateChannelHostInput('delivery.ack', {
      kind: 'turn', deliveryId: 'turn-1', externalConversationId: 'chat-1', ok: true,
    })).toMatchObject({ kind: 'turn' })
    expect(() => validateChannelHostInput('delivery.ack', {
      kind: 'turn', deliveryId: 'turn-1', ok: true,
    })).toThrow('externalConversationId')
  })

  it('maps Host events back to the transport payload shape', () => {
    expect(mapChannelEventToLegacy('turn.completed', {
      turnId: 'turn-1', externalConversationId: 'chat-1', text: 'done',
    })).toEqual({ turnId: 'turn-1', chatId: 'chat-1', text: 'done' })
  })

  it('builds transport configuration only from scoped App init data', () => {
    const config = loadConfigFromAppContext({
      config: {
        appId: 'cli_app',
        streamingCard: true,
        allowedUsers: ['ou_allowed'],
        pairedUsers: [{ userId: 'ou_paired', displayName: 'User', pairedAt: 10 }],
        pairing: { code: 'ABC234', createdAt: 10, expiresAt: 20 },
      },
      secrets: {
        appSecret: 'secret', encryptKey: 'encrypt', verificationToken: 'verify',
      },
      dataDir: '/app/data',
    })
    expect(config).toMatchObject({
      pairing: { code: 'ABC234', createdAt: 10, expiresAt: 20 },
      feishu: {
        appId: 'cli_app',
        appSecret: 'secret',
        encryptKey: 'encrypt',
        verificationToken: 'verify',
        allowedUsers: ['ou_allowed'],
        pairedUsers: [{ userId: 'ou_paired' }],
        defaultWorkDir: '/app/data',
        streamingCard: true,
      },
    })
  })
})
