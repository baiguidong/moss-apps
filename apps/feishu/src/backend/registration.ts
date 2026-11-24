import { randomUUID } from 'node:crypto'
import { registerApp } from '@larksuiteoapi/node-sdk'
import type { RegistrationStatus } from '../contracts'

// The MossWork scan flow uses the Feishu SDK's create-only registration.
export function createRegistration(register = registerApp) {
  let active: { id: string; abort: AbortController; result: RegistrationStatus } | undefined

  function stop(id?: string) {
    if (!active || (id !== undefined && active.id !== id)) return
    active.abort.abort()
    active = undefined
  }

  function start() {
    stop()
    const attempt = {
      id: randomUUID(),
      abort: new AbortController(),
      result: { status: 'running' } as RegistrationStatus,
    }
    active = attempt
    void register({
      source: 'moss',
      domain: 'accounts.feishu.cn',
      larkDomain: 'accounts.larksuite.com',
      appPreset: { desc: '由 Moss 一键创建的飞书机器人' },
      createOnly: true,
      signal: attempt.abort.signal,
      onQRCodeReady: ({ url }) => {
        attempt.result = { status: 'running', qr_url: url }
      },
    }).then(result => {
      attempt.result = {
        status: 'finished',
        app_id: result.client_id,
        app_secret: result.client_secret,
        domain: result.user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu',
      }
    }).catch((error: unknown) => {
      const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined
      attempt.result = {
        status: 'failed',
        reason: code === 'expired_token' ? '二维码已过期，请重新生成' : '飞书机器人创建失败',
      }
    })
    return { id: attempt.id }
  }

  function poll(id: unknown): RegistrationStatus {
    return active && active.id === id ? active.result : { status: 'not_started' }
  }

  return { start, stop, poll }
}
