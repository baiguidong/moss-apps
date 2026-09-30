import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { releaseNotesForVersion, validateRepositoryAppToolSchemas } from './lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('release metadata', () => {
  test('extracts the requested App version notes from CHANGELOG.md', () => {
    const notes = releaseNotesForVersion(path.join(repoRoot, 'apps', 'feishu'), '0.1.3')
    expect(notes).toContain('飞书设置页改用 Moss 桌面端统一的颜色')
    expect(notes).toContain('完整跟随 Moss 的浅色、深色与背景样式')
    expect(notes).not.toContain('## 0.1.2')
  })
})

test('repository and package validation reject invalid tool schemas with their source location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-app-tool-schema-'))
  const manifest = {
    id: 'example.catalog',
    contributes: { tools: [{ id: 'search', inputSchema: 'input.json' }] },
  }
  try {
    fs.writeFileSync(path.join(root, 'input.json'), JSON.stringify({
      type: 'object',
      allOf: [{ properties: { query: { type: 'string' } }, required: ['query'] }],
    }))
    expect(() => validateRepositoryAppToolSchemas(root, manifest))
      .toThrow('App example.catalog tool search inputSchema (input.json) must not declare top-level allOf')

    const schema = { type: 'object', properties: { query: { enum: ['a', 'b'] } }, required: ['query'] }
    fs.writeFileSync(path.join(root, 'input.json'), JSON.stringify(schema))
    expect(() => validateRepositoryAppToolSchemas(root, manifest)).not.toThrow()
    expect(JSON.parse(fs.readFileSync(path.join(root, 'input.json'), 'utf8'))).toEqual(schema)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
