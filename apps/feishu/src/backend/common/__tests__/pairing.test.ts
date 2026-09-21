import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isAllowedUser, tryPair } from '../pairing.js'

describe('adapter pairing settings persistence', () => {
  let tmpDir: string
  const previousConfigDir = process.env.MOSS_CONFIG_DIR

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-pairing-'))
    process.env.MOSS_CONFIG_DIR = tmpDir
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({
      model: 'test-model',
      adapters: {
        pairing: {
          code: 'ABC234',
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now(),
        },
        feishu: { pairedUsers: [], allowedUsers: [] },
      },
    }))
  })

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
    else process.env.MOSS_CONFIG_DIR = previousConfigDir
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('stores a paired user under settings.adapters and preserves other settings', () => {
    expect(tryPair('abc234', {
      userId: 'ou_test_user',
      displayName: 'Test User',
    })).toBe(true)

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'))
    expect(saved.model).toBe('test-model')
    expect(saved.adapters.pairing.code).toBeNull()
    expect(saved.adapters.feishu.pairedUsers).toHaveLength(1)
    expect(isAllowedUser('ou_test_user')).toBe(true)
  })
})
