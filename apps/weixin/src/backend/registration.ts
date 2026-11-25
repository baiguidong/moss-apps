import { randomUUID } from 'node:crypto'
import { AppServiceError, type AppBackendContext } from '@moss/app-sdk'
import type { RegistrationStatus } from '../contracts'
import { launchGateway } from './gateway'

export function createRegistration(launch = launchGateway) {
  let active: { id: string; abort: AbortController; result: RegistrationStatus } | undefined

  function stop(id?: string) {
    if (!active || (id !== undefined && id !== active.id)) return
    active.abort.abort()
    active = undefined
  }

  function start(context: AppBackendContext) {
    stop()
    const attempt = {
      id: randomUUID(), abort: new AbortController(), result: { status: 'running' } as RegistrationStatus,
    }
    active = attempt
    let url: string | undefined
    void launch(context, {}, event => {
      if (active !== attempt) return
      if (event.event === 'qr' && typeof event.url === 'string') {
        url = event.url
        attempt.result = { status: 'running', qr_url: url }
      } else if (event.event === 'scanned') {
        attempt.result = { status: 'running', qr_url: url, scanned: true }
      } else if (event.event === 'confirmed' && typeof event.accountId === 'string' &&
          typeof event.token === 'string' && event.token && typeof event.baseUrl === 'string') {
        attempt.result = { status: 'finished', accountId: event.accountId, token: event.token, baseUrl: event.baseUrl }
      } else if (event.event === 'error') {
        attempt.result = { status: 'failed', reason: '微信扫码登录失败或已过期，请重新生成' }
      }
    }, { login: true, signal: attempt.abort.signal }).then(async worker => {
      await worker.done
      if (attempt.result.status === 'running') throw new Error('login ended')
    }).catch(error => {
      if (active === attempt) attempt.result = {
        status: 'failed', reason: error instanceof AppServiceError ? error.message : '微信扫码登录失败，请检查网络后重试',
      }
    })
    return { id: attempt.id }
  }

  return { start, stop, poll: (id: unknown): RegistrationStatus =>
    active && id === active.id ? active.result : { status: 'not_started' } }
}
