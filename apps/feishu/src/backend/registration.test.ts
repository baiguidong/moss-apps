import { expect, test } from 'bun:test'
import type { registerApp } from '@larksuiteoapi/node-sdk'
import { createRegistration } from './registration'

test('uses the Moss create-only registration and exposes credentials after confirmation', async () => {
  const register: typeof registerApp = async options => {
    expect(options.source).toBe('moss')
    expect(options.appPreset?.desc).toBe('由 Moss 一键创建的飞书机器人')
    expect(options.createOnly).toBe(true)
    options.onQRCodeReady({ url: 'https://accounts.feishu.cn/example', expireIn: 300 })
    return { client_id: 'cli_test', client_secret: 'test', user_info: { tenant_brand: 'feishu' } }
  }
  const registration = createRegistration(register)
  const { id } = registration.start()
  expect(registration.poll(id)).toEqual({ status: 'running', qr_url: 'https://accounts.feishu.cn/example' })
  await Promise.resolve()
  expect(registration.poll(id)).toMatchObject({ status: 'finished', app_id: 'cli_test', app_secret: 'test', domain: 'feishu' })
  registration.stop(id)
  expect(registration.poll(id)).toEqual({ status: 'not_started' })
})

test('regenerating aborts the previous registration and stale cancellation leaves the new code active', () => {
  const signals: AbortSignal[] = []
  const registration = createRegistration(({ signal }) => {
    if (signal) signals.push(signal)
    return new Promise(() => {})
  })
  const first = registration.start()
  const second = registration.start()
  expect(registration.poll(first.id)).toEqual({ status: 'not_started' })
  registration.stop(first.id)
  expect(signals.map(signal => signal.aborted)).toEqual([true, false])
  expect(registration.poll(second.id)).toEqual({ status: 'running' })
  registration.stop(second.id)
  expect(signals.map(signal => signal.aborted)).toEqual([true, true])
})
