import { expect, test } from 'bun:test'
import type { AppBackendContext } from '@moss/app-sdk'
import { createRegistration } from './registration'
import type { GatewayEvent } from './gateway'

test('QR refresh, phone confirmation and cancellation are scoped to the current login', () => {
  const workers: { send: (event: GatewayEvent) => void; signal?: AbortSignal }[] = []
  const registration = createRegistration((_context, _config, send, options) => {
    expect(options?.login).toBe(true)
    workers.push({ send, signal: options?.signal })
    return new Promise(() => {})
  })
  const context = {} as AppBackendContext
  const first = registration.start(context)
  const second = registration.start(context)
  expect(workers[0].signal?.aborted).toBe(true)
  registration.stop(first.id)
  workers[0].send({ event: 'confirmed', accountId: 'old', token: 'stale', baseUrl: '' })
  expect(registration.poll(first.id)).toEqual({ status: 'not_started' })
  const worker = workers[1]
  worker.send({ event: 'qr', url: 'first' })
  worker.send({ event: 'scanned' })
  expect(registration.poll(second.id)).toMatchObject({ scanned: true, qr_url: 'first' })
  worker.send({ event: 'qr', url: 'refreshed' })
  expect(registration.poll(second.id)).toEqual({ status: 'running', qr_url: 'refreshed' })
  worker.send({ event: 'confirmed', accountId: 'current', token: 'fixture', baseUrl: 'https://ilinkai.weixin.qq.com' })
  expect(registration.poll(second.id)).toMatchObject({ status: 'finished', accountId: 'current', token: 'fixture' })
  registration.stop(second.id)
  expect(worker.signal?.aborted).toBe(true)
  expect(registration.poll(second.id)).toEqual({ status: 'not_started' })
})
