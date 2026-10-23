import { test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareIsolatedDbxProfile } from './dbx-credentials.mjs'

test('isolated DBX provisioning is persistent, private and never replaces a missing key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-dbx-keys-'))
  try {
    const profile = path.join(root, '独立 DBX')
    const env = prepareIsolatedDbxProfile(profile)
    const original = fs.readFileSync(env.DBX_SECRET_KEY_FILE)
    expect(prepareIsolatedDbxProfile(profile)).toEqual(env)
    expect(fs.readFileSync(env.DBX_SECRET_KEY_FILE)).toEqual(original)
    if (process.platform !== 'win32') {
      expect(fs.statSync(profile).mode & 0o777).toBe(0o700)
      expect(fs.statSync(env.DBX_SECRET_KEY_FILE).mode & 0o777).toBe(0o600)
    }
    fs.unlinkSync(env.DBX_SECRET_KEY_FILE)
    expect(() => prepareIsolatedDbxProfile(profile)).toThrow('refusing to generate a replacement key')
    const existing = path.join(root, 'existing')
    fs.mkdirSync(existing)
    fs.writeFileSync(path.join(existing, 'dbx.db'), 'existing data')
    expect(() => prepareIsolatedDbxProfile(existing)).toThrow('refusing to generate a replacement key')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('isolated DBX provisioning refuses symlinked profiles and corrupt keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-dbx-keys-'))
  try {
    const real = path.join(root, 'real')
    fs.mkdirSync(real)
    const redirected = path.join(root, 'redirected')
    fs.symlinkSync(real, redirected, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => prepareIsolatedDbxProfile(redirected)).toThrow('real directory')
    const env = prepareIsolatedDbxProfile(real)
    fs.writeFileSync(env.DBX_SECRET_KEY_FILE, 'invalid')
    expect(() => prepareIsolatedDbxProfile(real)).toThrow('restore it instead of replacing it')
    expect(fs.readFileSync(env.DBX_SECRET_KEY_FILE, 'utf8')).toBe('invalid')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
