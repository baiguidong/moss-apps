import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseNotesForVersion } from './lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('release metadata', () => {
  test('extracts the requested App version notes from CHANGELOG.md', () => {
    const notes = releaseNotesForVersion(path.join(repoRoot, 'apps', 'feishu'), '0.1.2')
    expect(notes).toContain('将飞书配置集中到 App 设置页')
    expect(notes).toContain('管理页仅保留运行控制和日志')
  })
})
