import { describe, expect, it } from 'bun:test'
import { splitMessage } from '../format.js'

describe('splitMessage', () => {
  it('returns one chunk for short text', () => {
    expect(splitMessage('hello', 10)).toEqual(['hello'])
  })

  it('prefers paragraph boundaries', () => {
    expect(splitMessage('first paragraph\n\nsecond paragraph', 20))
      .toEqual(['first paragraph', 'second paragraph'])
  })

  it('hard-splits text without a natural boundary', () => {
    expect(splitMessage('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('preserves all non-boundary content', () => {
    const source = 'alpha beta gamma delta epsilon'
    expect(splitMessage(source, 12).join(' ')).toBe(source)
  })
})
