import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseNotesForVersion } from './lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('release metadata', () => {
  test('extracts the requested App version notes from CHANGELOG.md', () => {
    const notes = releaseNotesForVersion(path.join(repoRoot, 'apps', 'feishu'), '0.1.3')
    expect(notes).toContain('飞书设置页改用 Moss 桌面端统一的颜色')
    expect(notes).toContain('完整跟随 Moss 的浅色、深色与背景样式')
    expect(notes).not.toContain('## 0.1.2')
  })
})
