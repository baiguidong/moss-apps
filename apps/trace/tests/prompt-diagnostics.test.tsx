import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PromptDiagnostics } from '../src/components/trace/detail/PromptDiagnostics'

test('composition shows measured rows, duplicates and incomplete coverage without pretending to know provenance or billing', () => {
  const markup = renderToStaticMarkup(<PromptDiagnostics value={{ version: 1, metric: 'utf8-content-bytes', unmeasuredBlocks: 1, rows: [
    { kind: 'system', location: 'system[0]', bytes: 128, characters: 64 },
    { kind: 'message', location: 'messages[0]', bytes: 128, characters: 64, duplicateOf: 'system[0]' },
  ] }} />)
  expect(markup).toContain('统计不完整')
  expect(markup).toContain('完全重复')
  expect(markup).toContain('细分来源尚未记录')
  expect(markup).toContain('不等于计费 token')
  expect(renderToStaticMarkup(<PromptDiagnostics value={{ version: 2 }} />)).toBe('')
})
