import { EventEmitter } from 'node:events'
import { AppBackendClient } from '../client/index.mjs'

export function createBackendTestHarness(actions = {}) {
  const host = new EventEmitter()
  const backend = new EventEmitter()
  const received = []
  const client = new AppBackendClient({
    send(message) {
      received.push(message)
      host.emit('message', message)
    },
    onMessage(handler) {
      backend.on('message', handler)
    },
  }).start(actions)
  return {
    client,
    received,
    host,
    send(message) { backend.emit('message', message) },
  }
}
