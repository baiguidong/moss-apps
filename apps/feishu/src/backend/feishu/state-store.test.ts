import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFeishuStateStore } from './state-store.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-feishu-state-'))
  roots.push(root)
  let timestamp = 1_000
  return {
    root,
    store: createFeishuStateStore(root, { now: () => timestamp }),
    advance(ms: number) { timestamp += ms },
  }
}

describe('Feishu state store', () => {
  it('issues one-time pairing codes and persists paired users', () => {
    const { root, store } = fixture()
    const issued = store.issuePairingCode()
    expect(issued.code).toHaveLength(6)
    expect(store.tryPair(issued.code, { userId: 'ou_user', displayName: 'User' })).toEqual({
      paired: true,
      alreadyPaired: false,
      rateLimited: false,
    })
    expect(store.tryPair('anything', { userId: 'ou_user' }).alreadyPaired).toBe(true)
    expect(createFeishuStateStore(root).listPairedUsers()).toMatchObject([{ userId: 'ou_user' }])
    expect(store.pairingStatus().active).toBe(false)
  })

  it('expires codes, rate limits failures, and supports revocation', () => {
    const { store, advance } = fixture()
    const issued = store.issuePairingCode()
    advance(60 * 60 * 1000 + 1)
    expect(store.tryPair(issued.code, { userId: 'ou_expired' }).paired).toBe(false)
    const next = store.issuePairingCode()
    for (let index = 0; index < 5; index += 1) {
      expect(store.tryPair('WRONG2', { userId: 'ou_limited' }).paired).toBe(false)
    }
    expect(store.tryPair(next.code, { userId: 'ou_limited' }).rateLimited).toBe(true)
    expect(store.tryPair(next.code, { userId: 'ou_other' }).paired).toBe(true)
    expect(store.revoke('ou_other')).toBe(true)
    expect(store.isPaired('ou_other')).toBe(false)
  })
})
