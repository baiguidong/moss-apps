import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readAdapterConfig, writeAdapterConfig } from '../config-store.js'

describe('adapter config store', () => {
  let tmpDir: string
  const previousConfigDir = process.env.MOSS_CONFIG_DIR

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-config-'))
    process.env.MOSS_CONFIG_DIR = tmpDir
  })

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
    else process.env.MOSS_CONFIG_DIR = previousConfigDir
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads only settings.json adapters and ignores legacy adapters.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'adapters.json'), JSON.stringify({ feishu: { appId: 'legacy' } }))
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({
      model: 'test-model',
      adapters: { feishu: { appId: 'current' } },
    }))

    expect(readAdapterConfig().feishu.appId).toBe('current')
  })

  it('updates adapters without replacing other desktop settings', () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({ model: 'test-model' }))
    writeAdapterConfig({ feishu: { appId: 'cli_test' } })

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'))
    expect(saved.model).toBe('test-model')
    expect(saved.adapters.feishu.appId).toBe('cli_test')
  })

  it('does not overwrite a malformed settings file', () => {
    const settingsPath = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(settingsPath, '{malformed')

    expect(() => writeAdapterConfig({ feishu: { appId: 'cli_test' } })).toThrow()
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe('{malformed')
  })
})
